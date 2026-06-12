import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getGitHubSession } from '../github/auth';
import { hasPendingGitHubWorktreeChanges, syncNotesWithGitHub } from '../github/gitSync';
import { reconcileGoogleDriveSyncState, syncNotesWithGoogleDrive } from '../googleDrive/driveSync';
import { getValidGoogleDriveAccessToken } from '../googleDrive/auth';
import { isConflictBackupNotePath } from '../utils/conflictBackups';
import { logError } from '../utils/logger';
import { findBrokenImageLinks, repairBrokenLocalImageLinks } from '../utils/markdownImages';
import { ensureSyncedNotesMetadataRecursively } from '../utils/noteMetadata';
import { resolveSyncedNotesPath } from '../utils/paths';

const ARCHIVE_DIRECTORY_NAME = '.quicknotes-archive';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)]\(([^)]+)\)/g;
export type SyncHealthState = 'Synced' | 'Syncing' | 'Offline' | 'Conflict';

interface SyncHealthStatus {
  state: SyncHealthState;
  detail: string;
  updatedAt: string;
}

function stripLinkDecorators(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isRemoteOrDataPath(linkPath: string): boolean {
  const lower = linkPath.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('mailto:')
  );
}

function toMarkdownPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function getUniqueTargetPath(basePath: string): Promise<string> {
  const parsed = path.parse(basePath);
  let candidate = basePath;
  let index = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function organizeImageLinksInMarkdown(markdownFilePath: string): Promise<boolean> {
  const noteDir = path.dirname(markdownFilePath);
  const assetsDir = path.join(noteDir, 'assets');
  const original = await fs.readFile(markdownFilePath, 'utf8');
  let changed = false;
  const rebuilt = original.replace(MARKDOWN_IMAGE_REGEX, (full, rawAlt: string, rawPath: string) => {
    const normalizedPath = stripLinkDecorators(rawPath);
    if (!normalizedPath || isRemoteOrDataPath(normalizedPath) || path.isAbsolute(normalizedPath)) {
      return full;
    }

    const imageExt = path.extname(normalizedPath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(imageExt)) {
      return full;
    }

    const absoluteImagePath = path.resolve(noteDir, normalizedPath);
    const absoluteAssetsDir = path.resolve(assetsDir);
    const relativeToAssetsDir = path.relative(absoluteAssetsDir, absoluteImagePath);
    const alreadyInAssets =
      relativeToAssetsDir.length > 0 &&
      !relativeToAssetsDir.startsWith('..') &&
      !path.isAbsolute(relativeToAssetsDir);

    // Keep a reasonable alt text by defaulting from file name when empty/placeholder.
    const currentAlt = rawAlt.trim();
    const isPlaceholderAlt = currentAlt.length === 0 || currentAlt.toLowerCase() === 'alt text';
    const nextAlt = isPlaceholderAlt ? path.parse(normalizedPath).name.replace(/[-_]+/g, ' ') : rawAlt;

    if (alreadyInAssets) {
      const rebuiltTag = `![${nextAlt}](${normalizedPath})`;
      if (rebuiltTag !== full) {
        changed = true;
      }
      return rebuiltTag;
    }

    // Defer moving here by tagging; async move handled in a second pass.
    return `__MOVE_IMAGE__${rawAlt}__PATH__${rawPath}__END__`;
  });

  let updated = rebuilt;
  const moveTags = updated.match(/__MOVE_IMAGE__[\s\S]*?__PATH__[\s\S]*?__END__/g) ?? [];

  for (const tag of moveTags) {
    const altSplit = tag.replace('__MOVE_IMAGE__', '').split('__PATH__');
    if (altSplit.length !== 2) {
      continue;
    }
    const originalAlt = altSplit[0];
    const originalPath = altSplit[1].replace('__END__', '');
    const normalizedPath = stripLinkDecorators(originalPath);
    const absoluteImagePath = path.resolve(noteDir, normalizedPath);

    try {
      await fs.access(absoluteImagePath);
    } catch {
      updated = updated.replace(tag, `![${originalAlt}](${originalPath})`);
      continue;
    }

    await fs.mkdir(assetsDir, { recursive: true });
    const targetPath = await getUniqueTargetPath(path.join(assetsDir, path.basename(absoluteImagePath)));
    await fs.rename(absoluteImagePath, targetPath);

    const relativeTargetPath = toMarkdownPath(path.relative(noteDir, targetPath));
    const fileBasedAlt = path.parse(targetPath).name.replace(/[-_]+/g, ' ');
    const currentAlt = originalAlt.trim();
    const isPlaceholderAlt = currentAlt.length === 0 || currentAlt.toLowerCase() === 'alt text';
    const nextAlt = isPlaceholderAlt ? fileBasedAlt : originalAlt;
    updated = updated.replace(tag, `![${nextAlt}](${relativeTargetPath})`);
    changed = true;
  }

  if (changed || updated !== original) {
    await fs.writeFile(markdownFilePath, updated, 'utf8');
    return true;
  }

  return false;
}

async function listMarkdownFilesRecursively(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      files.push(...(await listMarkdownFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
      if (!isConflictBackupNotePath(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function validateSyncedImageLinks(): Promise<{ noteFile: string; links: string[] }[]> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);
  const broken: Array<{ noteFile: string; links: string[] }> = [];

  for (const noteFile of markdownFiles) {
    if (noteFile.includes(`${path.sep}${ARCHIVE_DIRECTORY_NAME}${path.sep}`)) {
      continue;
    }
    const links = await findBrokenImageLinks(noteFile);
    if (links.length > 0) {
      broken.push({ noteFile, links });
    }
  }

  return broken;
}

async function repairSyncedImageLinks(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);

  for (const noteFile of markdownFiles) {
    await repairBrokenLocalImageLinks(noteFile);
  }
}

async function normalizeSyncedImageLocations(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);

  for (const noteFile of markdownFiles) {
    await organizeImageLinksInMarkdown(noteFile);
  }
}

async function normalizeSyncedNoteMetadata(): Promise<void> {
  await ensureSyncedNotesMetadataRecursively(resolveSyncedNotesPath());
}

async function collectReferencedImagePaths(markdownFiles: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();

  for (const markdownFilePath of markdownFiles) {
    const noteDir = path.dirname(markdownFilePath);
    const markdownContent = await fs.readFile(markdownFilePath, 'utf8');

    for (const match of markdownContent.matchAll(MARKDOWN_IMAGE_REGEX)) {
      const rawPath = match[2] ?? '';
      const normalizedPath = stripLinkDecorators(rawPath);
      if (!normalizedPath || isRemoteOrDataPath(normalizedPath) || path.isAbsolute(normalizedPath)) {
        continue;
      }
      const imageExt = path.extname(normalizedPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(imageExt)) {
        continue;
      }
      referenced.add(path.resolve(noteDir, normalizedPath));
    }
  }

  return referenced;
}

async function listImageFilesRecursively(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      if (entry.name === '.quicknotes-archive') {
        continue;
      }
      files.push(...(await listImageFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function cleanupOrphanedAssetsImages(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);
  const referenced = await collectReferencedImagePaths(markdownFiles);
  const assetImages = await listImageFilesRecursively(syncedRoot);

  for (const imagePath of assetImages) {
    if (!referenced.has(path.resolve(imagePath))) {
      await fs.unlink(imagePath);
    }
  }
}

function toUserFriendlySyncError(reason: string): string {
  const lower = reason.toLowerCase();

  if (
    lower.includes('eai_again') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('could not resolve host') ||
    lower.includes('could not read from remote repository') ||
    lower.includes('network is unreachable')
  ) {
    return 'No internet connection or GitHub is unreachable. Your notes are saved locally; reconnect and sync again.';
  }

  if (lower.includes('authentication') || lower.includes('401') || lower.includes('403')) {
    return 'GitHub authentication failed or expired. Reconnect your GitHub account and try syncing again.';
  }

  if (lower.includes('sync conflict detected')) {
    return reason;
  }

  return `Unable to sync notes right now. ${reason}`;
}

let syncInFlight: Promise<void> | null = null;
let queuedSyncRequested = false;
let queuedSyncNeedsPrompt = false;
let syncContextVersion = 0;
let initialSyncTransitionActive = false;
let currentSyncHealthStatus: SyncHealthStatus = {
  state: 'Offline',
  detail: 'Connect a sync provider to sync QuickNotes.',
  updatedAt: new Date(0).toISOString()
};

export function invalidateSyncContext(): void {
  syncContextVersion += 1;
  queuedSyncRequested = false;
  queuedSyncNeedsPrompt = false;
  initialSyncTransitionActive = false;
}

export function beginInitialSyncTransition(detail: string): void {
  initialSyncTransitionActive = true;
  setSyncHealthStatus('Syncing', detail);
}

export function endInitialSyncTransition(): void {
  initialSyncTransitionActive = false;
}

export function isInitialSyncTransitionActive(): boolean {
  return initialSyncTransitionActive;
}

export async function waitForCurrentSyncToFinish(): Promise<void> {
  if (!syncInFlight) {
    return;
  }

  try {
    await syncInFlight;
  } catch {
    // Let callers continue with a fresh sync attempt even if the previous run failed.
  }
}

function isSyncContextCurrent(version: number): boolean {
  return version === syncContextVersion;
}

function setSyncHealthStatus(state: SyncHealthState, detail: string): void {
  currentSyncHealthStatus = {
    state,
    detail,
    updatedAt: new Date().toISOString()
  };
}

export function getCurrentSyncHealthStatus(): SyncHealthStatus {
  return currentSyncHealthStatus;
}

function getSyncRecoveryHint(reason: string): { state: SyncHealthState; detail: string } {
  const lower = reason.toLowerCase();

  if (lower.includes('sync conflict detected')) {
    return {
      state: 'Conflict',
      detail: `${reason} Review the generated .local/.remote backups, keep the version you want, then run sync again.`
    };
  }

  if (
    lower.includes('authentication') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('connect a github account') ||
    lower.includes('google drive access token')
  ) {
    return {
      state: 'Offline',
      detail: 'Provider authentication needs attention. Reconnect and retry sync.'
    };
  }

  return {
    state: 'Offline',
    detail: 'GitHub is unreachable right now. Your notes are still local; reconnect and retry sync when online.'
  };
}

async function performSync(silent: boolean, contextVersion: number): Promise<void> {
  if (!isSyncContextCurrent(contextVersion)) {
    return;
  }

  const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
  if (localOnlyMode) {
    setSyncHealthStatus('Offline', 'Local-only mode is enabled. Disable it to sync notes.');
    if (!silent) {
      vscode.window.showInformationMessage('Local-only mode is enabled. Disable it to sync notes.');
    }
    return;
  }

  const provider = vscode.workspace.getConfiguration().get<string>('devnotes.syncProvider', 'github').trim();
  const useGoogleDrive = provider === 'googleDrive';

  let accountLabel = 'Google Drive';
  if (!useGoogleDrive) {
    // Silent/background sync must never trigger interactive auth prompts.
    const session = await getGitHubSession(!silent);
    if (!session) {
      setSyncHealthStatus('Offline', 'GitHub is not connected. Connect your account to resume syncing.');
      if (!silent) {
        vscode.window.showWarningMessage('GitHub authentication is required to sync notes.');
      }
      return;
    }
    accountLabel = session.account.label;
  }

  if (!isSyncContextCurrent(contextVersion)) {
    return;
  }

  setSyncHealthStatus('Syncing', `Syncing QuickNotes with ${useGoogleDrive ? 'Google Drive' : 'GitHub'} for ${accountLabel}...`);

        await normalizeSyncedNoteMetadata();
        await normalizeSyncedImageLocations();
        await repairSyncedImageLinks();
        await cleanupOrphanedAssetsImages();
        const brokenImageLinks = await validateSyncedImageLinks();
  if (brokenImageLinks.length > 0) {
    const first = brokenImageLinks[0];
    const brokenList = first.links.slice(0, 3).join(', ');
    const fileName = path.basename(first.noteFile);
    vscode.window.showWarningMessage(
      `Sync warning: missing image file(s) in ${fileName}: ${brokenList}. QuickNotes will keep syncing the note text.`
    );
  }

  if (!isSyncContextCurrent(contextVersion)) {
    return;
  }

  if (useGoogleDrive) {
    const accessToken = (await getValidGoogleDriveAccessToken()).trim();
    if (!accessToken) {
      setSyncHealthStatus('Offline', 'Google Drive access token is missing. Connect Google Drive to resume syncing.');
      if (!silent) {
        vscode.window.showWarningMessage('Google Drive access token is required to sync notes.');
      }
      return;
    }
    await syncNotesWithGoogleDrive(accessToken);
  } else {
    const session = await getGitHubSession(!silent);
    if (!session) {
      setSyncHealthStatus('Offline', 'GitHub is not connected. Connect your account to resume syncing.');
      if (!silent) {
        vscode.window.showWarningMessage('GitHub authentication is required to sync notes.');
      }
      return;
    }
    await syncNotesWithGitHub(session);
  }

  if (!isSyncContextCurrent(contextVersion)) {
    return;
  }

  // Post-sync normalization: downloaded remote notes can still contain legacy metadata blocks.
  // Run cleanup again after provider sync so markdown stays stable for users.
  await normalizeSyncedNoteMetadata();
  await normalizeSyncedImageLocations();
  await repairSyncedImageLinks();
  await cleanupOrphanedAssetsImages();
  if (useGoogleDrive) {
    await reconcileGoogleDriveSyncState();
  } else {
    const session = await getGitHubSession(false);
    if (session && isSyncContextCurrent(contextVersion) && (await hasPendingGitHubWorktreeChanges())) {
      await syncNotesWithGitHub(session);
    }
  }

  if (!isSyncContextCurrent(contextVersion)) {
    return;
  }

  setSyncHealthStatus('Synced', `Last sync completed for ${accountLabel}.`);
  if (!silent) {
    vscode.window.showInformationMessage(`Notes sync completed for ${accountLabel}.`);
  }
}

async function runSyncWithQueue(initialSilent: boolean, contextVersion: number): Promise<void> {
  let silent = initialSilent;

  while (true) {
    if (!isSyncContextCurrent(contextVersion)) {
      return;
    }

    queuedSyncRequested = false;
    queuedSyncNeedsPrompt = false;
    await performSync(silent, contextVersion);

    if (!queuedSyncRequested) {
      return;
    }

    silent = !queuedSyncNeedsPrompt;
  }
}

export function registerSyncNotesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.syncNotes', async (arg?: unknown) => {
      const silent = Boolean(
        arg &&
        typeof arg === 'object' &&
        'silent' in arg &&
        (arg as { silent?: unknown }).silent
      );

      if (syncInFlight) {
        queuedSyncRequested = true;
        queuedSyncNeedsPrompt = queuedSyncNeedsPrompt || !silent;
        await syncInFlight;
        return;
      }

      const contextVersion = syncContextVersion;
      syncInFlight = runSyncWithQueue(silent, contextVersion);

      try {
        await syncInFlight;
      } catch (error) {
        logError('Failed to sync notes', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        const recovery = getSyncRecoveryHint(reason);
        setSyncHealthStatus(recovery.state, recovery.detail);
        if (!silent) {
          vscode.window.showErrorMessage(toUserFriendlySyncError(reason));
        }
      } finally {
        syncInFlight = null;
      }
    })
  );
}
