import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureNotesDirectory } from '../storage/localStorage';
import { runGit } from './gitClient';
import type { AuthenticationSession } from 'vscode';

export interface RepoConfig {
  owner: string;
  repoName: string;
  branch: string;
  remoteUrl: string;
  accountLogin: string;
}

function getRepoConfig(accountLabel: string, accountLogin: string): RepoConfig {
  const configuration = vscode.workspace.getConfiguration();
  const owner = configuration.get<string>('devnotes.repoOwner', '').trim() || accountLogin.trim();
  const repoName = configuration.get<string>('devnotes.repoName', 'devnotes-sync').trim();
  const branch = configuration.get<string>('devnotes.branch', 'main').trim();

  if (!owner) {
    throw new Error('Set devnotes.repoOwner in Settings to continue syncing.');
  }

  if (!repoName) {
    throw new Error('Set devnotes.repoName in Settings to continue syncing.');
  }

  return {
    owner,
    repoName,
    branch,
    remoteUrl: `https://github.com/${owner}/${repoName}.git`,
    accountLogin
  };
}

async function hasGitRepository(repoPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function ensureRemote(repoPath: string, remoteUrl: string): Promise<void> {
  const remotes = await runGit(repoPath, ['remote']);
  const hasOrigin = remotes.stdout.split('\n').some((remote) => remote.trim() === 'origin');

  if (!hasOrigin) {
    await runGit(repoPath, ['remote', 'add', 'origin', remoteUrl]);
    return;
  }

  await runGit(repoPath, ['remote', 'set-url', 'origin', remoteUrl]);
}

async function ensureGitBootstrap(repoPath: string, config: RepoConfig): Promise<void> {
  const isRepo = await hasGitRepository(repoPath);
  if (!isRepo) {
    await runGit(repoPath, ['init', '-b', config.branch]);
  }

  await ensureRemote(repoPath, config.remoteUrl);
}

async function githubRequest<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {})
    }
  });

  if (response.status === 204) {
    return { status: response.status, data: null };
  }

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }

  return { status: response.status, data };
}

async function ensureRemoteRepositoryExists(
  session: AuthenticationSession,
  config: RepoConfig
): Promise<void> {
  const token = session.accessToken;
  let repoCheck = await githubRequest<{ private?: boolean }>(
    `https://api.github.com/repos/${config.owner}/${config.repoName}`,
    token
  );

  if (repoCheck.status === 200) {
    return;
  }

  if (repoCheck.status !== 404) {
    throw new Error(`Unable to verify remote repository (${config.owner}/${config.repoName}).`);
  }

  const autoCreateRepo = vscode.workspace.getConfiguration().get<boolean>('devnotes.autoCreateRepo', true);
  if (!autoCreateRepo) {
    throw new Error(
      `Remote repository ${config.owner}/${config.repoName} was not found. Create it or enable devnotes.autoCreateRepo.`
    );
  }

  const accountLogin = config.accountLogin.trim().toLowerCase();
  if (config.owner.trim().toLowerCase() !== accountLogin) {
    // Auto-heal stale/mismatched owner config so reconnecting with a different
    // GitHub account does not block first-time sync.
    const fallbackOwner = config.accountLogin.trim();
    config.owner = fallbackOwner;
    config.remoteUrl = `https://github.com/${fallbackOwner}/${config.repoName}.git`;
    await vscode.workspace
      .getConfiguration()
      .update('devnotes.repoOwner', fallbackOwner, vscode.ConfigurationTarget.Global);

    repoCheck = await githubRequest<{ private?: boolean }>(
      `https://api.github.com/repos/${config.owner}/${config.repoName}`,
      token
    );

    if (repoCheck.status === 200) {
      return;
    }

    if (repoCheck.status !== 404) {
      throw new Error(`Unable to verify remote repository (${config.owner}/${config.repoName}).`);
    }
  }

  const createResponse = await githubRequest(
    'https://api.github.com/user/repos',
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: config.repoName,
        private: true,
        auto_init: false,
        description: 'QuickNotes notes sync repository'
      })
    }
  );

  if (createResponse.status !== 201) {
    throw new Error(`Unable to auto-create repository ${config.owner}/${config.repoName}.`);
  }
}

async function resolveAuthenticatedLogin(session: AuthenticationSession): Promise<string> {
  const response = await githubRequest<{ login?: string }>(
    'https://api.github.com/user',
    session.accessToken
  );

  if (response.status !== 200 || !response.data?.login) {
    throw new Error('Unable to resolve authenticated GitHub username.');
  }

  return response.data.login;
}

export async function ensureNotesRepository(session: AuthenticationSession): Promise<RepoConfig> {
  const repoPath = await ensureNotesDirectory();
  const accountLogin = await resolveAuthenticatedLogin(session);
  const config = getRepoConfig(session.account.label, accountLogin);
  await ensureRemoteRepositoryExists(session, config);
  await ensureGitBootstrap(repoPath, config);
  return config;
}
