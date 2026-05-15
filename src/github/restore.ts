import type { AuthenticationSession } from 'vscode';
import { ensureNotesDirectory } from '../storage/localStorage';
import { runGit, runGitWithGitHubAuth } from './gitClient';
import { ensureNotesRepository } from './repoManager';

export interface RestoreResult {
  restored: boolean;
  reason?: string;
}

async function hasLocalMarkdownChanges(repoPath: string): Promise<boolean> {
  const status = await runGit(repoPath, ['status', '--porcelain', '--', '*.md']);
  return Boolean(status.stdout.trim());
}

async function remoteBranchExists(repoPath: string, branch: string, token: string): Promise<boolean> {
  const result = await runGitWithGitHubAuth(repoPath, ['ls-remote', '--heads', 'origin', branch], token);
  return Boolean(result.stdout.trim());
}

async function hasLocalHead(repoPath: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

export async function restoreNotesFromGitHub(session: AuthenticationSession): Promise<RestoreResult> {
  const repoPath = await ensureNotesDirectory();
  const config = await ensureNotesRepository(session);

  const dirty = await hasLocalMarkdownChanges(repoPath);
  if (dirty) {
    throw new Error('Local note changes detected. Sync or commit local notes before restore.');
  }

  const branchExists = await remoteBranchExists(repoPath, config.branch, session.accessToken);
  if (!branchExists) {
    return {
      restored: false,
      reason: `Remote branch ${config.branch} has no notes yet.`
    };
  }

  await runGitWithGitHubAuth(repoPath, ['fetch', 'origin', config.branch], session.accessToken);

  const hasHead = await hasLocalHead(repoPath);
  if (!hasHead) {
    await runGit(repoPath, ['checkout', '-B', config.branch, `origin/${config.branch}`]);
    return { restored: true };
  }

  await runGitWithGitHubAuth(repoPath, ['fetch', 'origin', config.branch], session.accessToken);
  await runGit(repoPath, ['rebase', `origin/${config.branch}`]);
  return { restored: true };
}
