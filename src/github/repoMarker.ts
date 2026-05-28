import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoConfig } from './repoManager';
import { runGit } from './gitClient';

export const QUICKNOTES_REPO_MARKER = '.quicknotes-sync.json';
const MARKER_VERSION = 1;

interface RepoMarker {
  app: 'quicknotes';
  version: number;
  owner: string;
  repo: string;
  branch: string;
  accountLogin: string;
  updatedAt: string;
}

function toMarker(config: RepoConfig): RepoMarker {
  return {
    app: 'quicknotes',
    version: MARKER_VERSION,
    owner: config.owner,
    repo: config.repoName,
    branch: config.branch,
    accountLogin: config.accountLogin,
    updatedAt: new Date().toISOString()
  };
}

function markerPath(repoPath: string): string {
  return path.join(repoPath, QUICKNOTES_REPO_MARKER);
}

function hasSameRepoIdentity(marker: RepoMarker | null, config: RepoConfig): boolean {
  if (!marker) {
    return false;
  }

  return (
    marker.app === 'quicknotes' &&
    marker.version === MARKER_VERSION &&
    marker.owner === config.owner &&
    marker.repo === config.repoName &&
    marker.branch === config.branch &&
    marker.accountLogin === config.accountLogin
  );
}

export async function readRepoMarker(repoPath: string): Promise<RepoMarker | null> {
  const filePath = markerPath(repoPath);
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.app !== 'quicknotes') {
      return null;
    }
    return parsed as RepoMarker;
  } catch {
    return null;
  }
}

export async function assertRepoMarkerMatches(repoPath: string, config: RepoConfig): Promise<void> {
  const marker = await readRepoMarker(repoPath);
  if (!marker) {
    return;
  }

  const repoAndBranchMatch = marker.repo === config.repoName && marker.branch === config.branch;
  const ownerOrAccountDrift = marker.owner !== config.owner || marker.accountLogin !== config.accountLogin;
  if (repoAndBranchMatch && ownerOrAccountDrift) {
    // Auto-heal stale owner/account marker metadata when users reconnect with another GitHub account.
    await writeRepoMarker(repoPath, config);
    return;
  }

  const mismatches: string[] = [];
  if (marker.owner !== config.owner) {
    mismatches.push(`owner=${marker.owner}`);
  }
  if (marker.repo !== config.repoName) {
    mismatches.push(`repo=${marker.repo}`);
  }
  if (marker.branch !== config.branch) {
    mismatches.push(`branch=${marker.branch}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `QuickNotes repo marker does not match current VS Code sync settings (${mismatches.join(', ')}). Review repo owner/name/branch before syncing.`
    );
  }
}

export async function writeRepoMarker(repoPath: string, config: RepoConfig): Promise<boolean> {
  const filePath = markerPath(repoPath);
  const current = await fs.readFile(filePath, 'utf8').catch(() => '');
  const currentMarker = await readRepoMarker(repoPath);

  if (hasSameRepoIdentity(currentMarker, config)) {
    return false;
  }

  const next = `${JSON.stringify(toMarker(config), null, 2)}\n`;
  if (current === next) {
    return false;
  }

  await fs.writeFile(filePath, next, 'utf8');
  return true;
}

export async function cleanupRepoMarkerIfOnlyInternalDrift(repoPath: string, config: RepoConfig): Promise<boolean> {
  const currentMarker = await readRepoMarker(repoPath);
  if (!hasSameRepoIdentity(currentMarker, config)) {
    return false;
  }

  const status = await runGit(repoPath, ['status', '--porcelain', '--', QUICKNOTES_REPO_MARKER]);
  if (!status.stdout.trim()) {
    return false;
  }

  await runGit(repoPath, ['restore', '--worktree', '--staged', '--', QUICKNOTES_REPO_MARKER]).catch(async () => {
    await runGit(repoPath, ['restore', '--worktree', '--', QUICKNOTES_REPO_MARKER]).catch(() => undefined);
  });

  return true;
}
