import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureNotesDirectory } from '../storage/localStorage';
import { runGit, runGitWithGitHubAuth } from './gitClient';
import { ensureNotesRepository } from './repoManager';
import type { AuthenticationSession } from 'vscode';

const SYNCABLE_NOTE_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

function isSyncableNotesFile(filePath: string): boolean {
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
      const backups = await createConflictBackups(repoPath);
      await abortRebase(repoPath);
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

async function hasSyncableChanges(repoPath: string): Promise<boolean> {
  // Use NUL-delimited porcelain output for robust parsing of nested/quoted paths.
  const status = await runGit(repoPath, ['status', '--porcelain', '-z']);
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
  await sanitizeNestedAccountsInRepo(repoPath);
  const config = await ensureNotesRepository(session);
  await ensureCommitIdentity(repoPath, session.account.label, config.accountLogin);

  // Commit local markdown changes first so rebase pull never fails on unstaged edits/deletes.
  let hasLocalCommit = false;
  const changed = await hasSyncableChanges(repoPath);
  if (changed) {
    await runGit(repoPath, ['add', '-A', '.']);
    await runGit(repoPath, ['commit', '-m', 'chore(notes): sync developer notes']);
    hasLocalCommit = true;
  }

  await pullWithRebase(repoPath, config.branch, session.accessToken);

  if (hasLocalCommit) {
    await runGitWithGitHubAuth(repoPath, ['push', '-u', 'origin', config.branch], session.accessToken);
  }
}
