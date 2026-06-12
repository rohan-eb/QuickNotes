import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureNotesDirectory } from '../storage/localStorage';
import { runGit, runGitWithGitHubAuth } from './gitClient';
import { ensureNotesRepository } from './repoManager';
import type { AuthenticationSession } from 'vscode';
import {
  QUICKNOTES_REPO_MARKER,
  assertRepoMarkerMatches,
  cleanupRepoMarkerIfOnlyInternalDrift,
  hideRepoMarkerFromGitStatus,
  writeRepoMarker
} from './repoMarker';
import { closeOpenTabForFile } from '../utils/editorCleanup';
import { isConflictBackupNotePath } from '../utils/conflictBackups';

const SYNCABLE_NOTE_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const SYNCABLE_INTERNAL_FILES = new Set(['.quicknotes-metadata.json']);
const INTERNAL_BOOTSTRAP_FILES = [QUICKNOTES_REPO_MARKER, '.quicknotes-metadata.json'];

function isSyncableNotesFile(filePath: string): boolean {
  if (path.basename(filePath) === QUICKNOTES_REPO_MARKER) {
    return false;
  }
  if (SYNCABLE_INTERNAL_FILES.has(path.basename(filePath))) {
    return true;
  }
  if (isConflictBackupNotePath(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return SYNCABLE_NOTE_EXTENSIONS.has(ext);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function mergeDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      const targetIsDir = await fs
        .stat(targetPath)
        .then((stat) => stat.isDirectory())
        .catch(() => false);

      if (targetIsDir) {
        await mergeDirectoryContents(sourcePath, targetPath);
        await fs.rm(sourcePath, { recursive: true, force: true });
      } else if (!(await pathExists(targetPath))) {
        await fs.rename(sourcePath, targetPath);
      }
      continue;
    }

    if (!(await pathExists(targetPath))) {
      await fs.rename(sourcePath, targetPath);
    }
  }
}

async function sanitizeNestedAccountsInRepo(repoPath: string): Promise<void> {
  const nestedAccountsPath = path.join(repoPath, 'accounts');
  const hasNestedAccounts = await fs
    .stat(nestedAccountsPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (!hasNestedAccounts) {
    return;
  }

  const currentAccountKey = path.basename(repoPath);
  const nestedCurrentAccountPath = path.join(nestedAccountsPath, currentAccountKey);
  const hasNestedCurrentAccount = await fs
    .stat(nestedCurrentAccountPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (hasNestedCurrentAccount) {
    await mergeDirectoryContents(nestedCurrentAccountPath, repoPath);
    await fs.rm(nestedCurrentAccountPath, { recursive: true, force: true });
  }

  const parentDir = path.dirname(repoPath);
  const parentIsAccountsRoot = path.basename(parentDir) === 'accounts';

  if (parentIsAccountsRoot) {
    const nestedEntries = await fs.readdir(nestedAccountsPath, { withFileTypes: true }).catch(() => []);
    for (const entry of nestedEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourcePath = path.join(nestedAccountsPath, entry.name);
      const siblingPath = path.join(parentDir, entry.name);
      if (!(await pathExists(siblingPath))) {
        await fs.rename(sourcePath, siblingPath);
      }
    }
  }

  await fs.rm(nestedAccountsPath, { recursive: true, force: true });
}

async function removeInternalBootstrapFiles(repoPath: string): Promise<void> {
  for (const fileName of INTERNAL_BOOTSTRAP_FILES) {
    await fs.rm(path.join(repoPath, fileName), { force: true }).catch(() => undefined);
  }
}

async function safeReadStageBlob(repoPath: string, stage: '2' | '3', filePath: string): Promise<string> {
  try {
    const result = await runGit(repoPath, ['show', `:${stage}:${filePath}`]);
    return result.stdout;
  } catch {
    return '';
  }
}

function buildBackupFilePath(originalPath: string, variant: 'local' | 'remote'): string {
  const dirName = path.dirname(originalPath);
  const parsed = path.parse(originalPath);
  const candidate = path.join(dirName, `${parsed.name}.${variant}.md`);
  return candidate;
}

async function createConflictBackups(repoPath: string): Promise<string[]> {
  const result = await runGit(repoPath, ['diff', '--name-only', '--diff-filter=U', '--', '*.md']);
  const conflictedFiles = result.stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const createdBackups: string[] = [];

  for (const relativeFilePath of conflictedFiles) {
    const absoluteOriginalPath = path.join(repoPath, relativeFilePath);
    const localBackupPath = buildBackupFilePath(absoluteOriginalPath, 'local');
    const remoteBackupPath = buildBackupFilePath(absoluteOriginalPath, 'remote');

    const localContent = await safeReadStageBlob(repoPath, '2', relativeFilePath);
    const remoteContent = await safeReadStageBlob(repoPath, '3', relativeFilePath);

    await fs.writeFile(localBackupPath, localContent);
    await fs.writeFile(remoteBackupPath, remoteContent);

    createdBackups.push(localBackupPath, remoteBackupPath);
  }

  return createdBackups;
}

async function getDeletedByRemoteFiles(repoPath: string): Promise<string[]> {
  const result = await runGit(repoPath, ['diff', '--name-only', '--diff-filter=U', '--', '*.md']);
  const conflictedFiles = result.stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const deletedByRemote: string[] = [];

  for (const relativeFilePath of conflictedFiles) {
    const localVersion = await safeReadStageBlob(repoPath, '2', relativeFilePath);
    const remoteVersion = await safeReadStageBlob(repoPath, '3', relativeFilePath);
    if (localVersion && !remoteVersion) {
      deletedByRemote.push(relativeFilePath);
    }
  }

  return deletedByRemote;
}

async function abortRebase(repoPath: string): Promise<void> {
  try {
    await runGit(repoPath, ['rebase', '--abort']);
  } catch {
    // no-op: if rebase state is already cleared we can continue.
  }
}

async function pullWithRebase(repoPath: string, branch: string, token: string): Promise<void> {
  try {
    await runGitWithGitHubAuth(repoPath, ['fetch', 'origin', branch], token);
    if (!(await hasLocalHead(repoPath))) {
      await runGit(repoPath, ['checkout', '-B', branch, `origin/${branch}`]);
      return;
    }
    await runGit(repoPath, ['rebase', `origin/${branch}`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('couldn\'t find remote ref') ||
      message.includes('no such ref was fetched') ||
      message.includes('could not read from remote repository')
    ) {
      // Remote branch may not exist yet on first sync, or repo access is not ready.
      return;
    }

    if (message.includes('CONFLICT') || message.includes('could not apply')) {
      const deletedByRemote = await getDeletedByRemoteFiles(repoPath);
      if (deletedByRemote.length > 0) {
        for (const relativeFilePath of deletedByRemote) {
          await closeOpenTabForFile(path.join(repoPath, relativeFilePath));
        }
      }
      const backups = await createConflictBackups(repoPath);
      await abortRebase(repoPath);
      if (deletedByRemote.length > 0) {
        await removeFilesAndPruneParents(repoPath, deletedByRemote);
      }
      const backupSummary = backups.length > 0 ? backups.map((file) => path.basename(file)).join(', ') : '';
      throw new Error(
        backupSummary
          ? `Sync conflict detected. Created backup files: ${backupSummary}`
          : 'Sync conflict detected. Rebase aborted safely.'
      );
    }

    await abortRebase(repoPath);
    throw error;
  }
}

async function remoteBranchExists(repoPath: string, branch: string, token: string): Promise<boolean> {
  const result = await runGitWithGitHubAuth(repoPath, ['ls-remote', '--heads', 'origin', branch], token);
  return Boolean(result.stdout.trim());
}

async function hasSharedHistoryWithRemote(repoPath: string, branch: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['merge-base', 'HEAD', `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function alignRepoToRemoteBranch(repoPath: string, branch: string, token: string): Promise<void> {
  await runGitWithGitHubAuth(repoPath, ['fetch', 'origin', branch], token);
  await removeInternalBootstrapFiles(repoPath);
  await runGit(repoPath, ['checkout', '-B', branch, `origin/${branch}`]);
}

async function hasLocalHead(repoPath: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function hasSyncableChanges(repoPath: string): Promise<boolean> {
  // Include all untracked files (not just directory placeholders) so new notes
  // inside freshly-created folders are detected and committed.
  const status = await runGit(repoPath, ['status', '--porcelain', '-z', '-uall']);
  const records = status.stdout.split('\0').filter(Boolean);

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.length < 4) {
      continue;
    }

    const statusCode = record.slice(0, 2);
    let filePath = record.slice(3);

    const isRenameOrCopy =
      statusCode[0] === 'R' || statusCode[0] === 'C' || statusCode[1] === 'R' || statusCode[1] === 'C';

    if (isRenameOrCopy && i + 1 < records.length) {
      filePath = records[i + 1];
      i += 1;
    }

    if (isSyncableNotesFile(filePath)) {
      return true;
    }
  }

  return false;
}

async function hasAnyWorktreeChanges(repoPath: string): Promise<boolean> {
  const status = await runGit(repoPath, ['status', '--porcelain']);
  return status.stdout.trim().length > 0;
}

export async function hasPendingGitHubWorktreeChanges(): Promise<boolean> {
  const repoPath = await ensureNotesDirectory();
  return hasAnyWorktreeChanges(repoPath);
}

async function commitAllPendingChanges(repoPath: string): Promise<boolean> {
  if (!(await hasAnyWorktreeChanges(repoPath))) {
    return false;
  }

  // Stage the whole managed sync repo instead of trying to hand-pick paths.
  // This repo only stores QuickNotes content plus app-managed metadata, and
  // broad staging is more reliable for internal sidecar updates/deletions.
  await runGit(repoPath, ['add', '-A', '--', '.']);

  try {
    await runGit(repoPath, ['commit', '-m', 'chore(notes): sync developer notes']);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nothing to commit')) {
      return false;
    }
    throw error;
  }
}

async function removeFilesAndPruneParents(repoPath: string, relativePaths: string[]): Promise<void> {
  const dirsToCheck = new Set<string>();
  const resolvedRepoPath = path.resolve(repoPath);

  for (const relativeFilePath of relativePaths) {
    const absolutePath = path.join(repoPath, relativeFilePath);
    await fs.rm(absolutePath, { force: true });
    dirsToCheck.add(path.dirname(absolutePath));
  }

  for (const startDir of [...dirsToCheck].sort((a, b) => b.length - a.length)) {
    let currentDir = path.resolve(startDir);

    while (currentDir.startsWith(resolvedRepoPath) && currentDir !== resolvedRepoPath) {
      const entries = await fs.readdir(currentDir).catch(() => []);
      if (entries.length > 0) {
        break;
      }

      await fs.rmdir(currentDir).catch(() => undefined);
      currentDir = path.dirname(currentDir);
    }
  }
}

async function flushPendingChanges(repoPath: string, maxPasses = 3): Promise<boolean> {
  let committed = false;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const changed = await commitAllPendingChanges(repoPath);
    committed = committed || changed;

    if (!(await hasAnyWorktreeChanges(repoPath))) {
      return committed;
    }
  }

  return committed;
}

async function ensureCommitIdentity(
  repoPath: string,
  displayName: string,
  accountLogin: string
): Promise<void> {
  const hasUserName = await runGit(repoPath, ['config', '--get', 'user.name']).then(
    (result) => Boolean(result.stdout),
    () => false
  );
  const hasUserEmail = await runGit(repoPath, ['config', '--get', 'user.email']).then(
    (result) => Boolean(result.stdout),
    () => false
  );

  if (!hasUserName) {
    await runGit(repoPath, ['config', 'user.name', displayName]);
  }
  if (!hasUserEmail) {
    await runGit(repoPath, ['config', 'user.email', `${accountLogin}@users.noreply.github.com`]);
  }
}

export async function syncNotesWithGitHub(session: AuthenticationSession): Promise<void> {
  const repoPath = await ensureNotesDirectory();
  await abortRebase(repoPath);
  await sanitizeNestedAccountsInRepo(repoPath);
  const config = await ensureNotesRepository(session);
  await ensureCommitIdentity(repoPath, session.account.label, config.accountLogin);

  const localHeadExists = await hasLocalHead(repoPath);
  if (!localHeadExists) {
    const branchExists = await remoteBranchExists(repoPath, config.branch, session.accessToken);
    if (branchExists) {
      const hasLocalSyncableChanges = await hasSyncableChanges(repoPath);
      if (!hasLocalSyncableChanges) {
        await alignRepoToRemoteBranch(repoPath, config.branch, session.accessToken);
      }
    }
  } else if (await remoteBranchExists(repoPath, config.branch, session.accessToken)) {
    const hasSharedHistory = await hasSharedHistoryWithRemote(repoPath, config.branch);
    if (!hasSharedHistory && !(await hasSyncableChanges(repoPath))) {
      // Account-switched folders can inherit an unrelated local Git history.
      // Realign that account-scoped repo to its own remote branch before sync.
      await alignRepoToRemoteBranch(repoPath, config.branch, session.accessToken);
    }
  }

  await assertRepoMarkerMatches(repoPath, config);

  await cleanupRepoMarkerIfOnlyInternalDrift(repoPath, config);
  await writeRepoMarker(repoPath, config);
  await hideRepoMarkerFromGitStatus(repoPath);

  // Commit local markdown changes first so rebase pull never fails on unstaged edits/deletes.
  let hasLocalCommit = false;
  const changed = await hasSyncableChanges(repoPath);
  if (changed) {
    hasLocalCommit = await flushPendingChanges(repoPath);
  }

  try {
    // A save-triggered sync can race with a final metadata write. Flush once more
    // right before rebase so Git never sees a dirty worktree at pull time.
    hasLocalCommit = (await flushPendingChanges(repoPath)) || hasLocalCommit;
    await pullWithRebase(repoPath, config.branch, session.accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('cannot rebase') && message.includes('unstaged changes')) {
      hasLocalCommit = (await flushPendingChanges(repoPath)) || hasLocalCommit;
      await pullWithRebase(repoPath, config.branch, session.accessToken);
    } else if (message.includes('could not resolve head to a revision')) {
      const branchExists = await remoteBranchExists(repoPath, config.branch, session.accessToken);
      if (branchExists) {
        await runGitWithGitHubAuth(repoPath, ['fetch', 'origin', config.branch], session.accessToken);
        await runGit(repoPath, ['checkout', '-B', config.branch, `origin/${config.branch}`]);
        await pullWithRebase(repoPath, config.branch, session.accessToken);
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (hasLocalCommit) {
    await runGitWithGitHubAuth(repoPath, ['push', '-u', 'origin', config.branch], session.accessToken);
  }
}
