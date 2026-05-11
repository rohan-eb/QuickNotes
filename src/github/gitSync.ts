import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureNotesDirectory } from '../storage/localStorage';
import { runGit, runGitWithGitHubAuth } from './gitClient';
import { ensureNotesRepository } from './repoManager';
import type { AuthenticationSession } from 'vscode';

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
    await runGitWithGitHubAuth(repoPath, ['pull', '--rebase', 'origin', branch], token);
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

async function hasMarkdownChanges(repoPath: string): Promise<boolean> {
  const status = await runGit(repoPath, ['status', '--porcelain', '--', '*.md']);
  return Boolean(status.stdout.trim());
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
  const config = await ensureNotesRepository(session);
  await ensureCommitIdentity(repoPath, session.account.label, config.accountLogin);

  // Commit local markdown changes first so rebase pull never fails on unstaged edits/deletes.
  let hasLocalCommit = false;
  const changed = await hasMarkdownChanges(repoPath);
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
