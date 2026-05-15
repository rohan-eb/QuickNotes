import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getGitHubSession } from '../github/auth';
import { syncNotesWithGitHub } from '../github/gitSync';
import { logError } from '../utils/logger';
import { findBrokenImageLinks } from '../utils/markdownImages';
import { resolveSyncedNotesPath } from '../utils/paths';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)]\(([^)]+)\)/g;

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
      files.push(fullPath);
    }
  }

  return files;
}

async function validateSyncedImageLinks(): Promise<{ noteFile: string; links: string[] }[]> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);
  const broken: Array<{ noteFile: string; links: string[] }> = [];

  for (const noteFile of markdownFiles) {
    const links = await findBrokenImageLinks(noteFile);
    if (links.length > 0) {
      broken.push({ noteFile, links });
    }
  }

  return broken;
}

async function normalizeSyncedImageLocations(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);

  for (const noteFile of markdownFiles) {
    await organizeImageLinksInMarkdown(noteFile);
  }
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

async function listAssetsImageFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      if (entry.name === 'assets') {
        const assetEntries = await fs.readdir(fullPath, { withFileTypes: true });
        for (const assetEntry of assetEntries) {
          if (!assetEntry.isFile()) {
            continue;
          }
          const assetPath = path.join(fullPath, assetEntry.name);
          const ext = path.extname(assetPath).toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            files.push(assetPath);
          }
        }
        continue;
      }
      files.push(...(await listAssetsImageFiles(fullPath)));
    }
  }

  return files;
}

async function cleanupOrphanedAssetsImages(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  const markdownFiles = await listMarkdownFilesRecursively(syncedRoot);
  const referenced = await collectReferencedImagePaths(markdownFiles);
  const assetImages = await listAssetsImageFiles(syncedRoot);

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

export function registerSyncNotesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.syncNotes', async (arg?: unknown) => {
      try {
        const silent = Boolean(
          arg &&
          typeof arg === 'object' &&
          'silent' in arg &&
          (arg as { silent?: unknown }).silent
        );

        const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
        if (localOnlyMode) {
          if (!silent) {
            vscode.window.showInformationMessage('Local-only mode is enabled. Disable it to sync notes.');
          }
          return;
        }

        // Silent/background sync must never trigger interactive auth prompts.
        const session = await getGitHubSession(!silent);
        if (!session) {
          if (!silent) {
            vscode.window.showWarningMessage('GitHub authentication is required to sync notes.');
          }
          return;
        }

        await normalizeSyncedImageLocations();
        await cleanupOrphanedAssetsImages();
        const brokenImageLinks = await validateSyncedImageLinks();
        if (brokenImageLinks.length > 0) {
          const first = brokenImageLinks[0];
          const brokenList = first.links.slice(0, 3).join(', ');
          const fileName = path.basename(first.noteFile);
          vscode.window.showErrorMessage(
            `Sync blocked: missing image file(s) in ${fileName}: ${brokenList}. Use "Quick Notes: Insert Image Into Note" to copy image files into notes.`
          );
          return;
        }

        await syncNotesWithGitHub(session);
        if (!silent) {
          vscode.window.showInformationMessage(`Notes sync completed for ${session.account.label}.`);
        }
      } catch (error) {
        logError('Failed to sync notes', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        if (!arg || typeof arg !== 'object' || !(arg as { silent?: unknown }).silent) {
          vscode.window.showErrorMessage(toUserFriendlySyncError(reason));
        }
      }
    })
  );
}
