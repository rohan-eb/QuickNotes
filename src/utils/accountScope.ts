import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AuthenticationSession } from 'vscode';
import { resolveSyncedNotesBasePath } from './paths';

function sanitizeAccountKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'github-account';
}

function toGitHubAccountKey(session: AuthenticationSession): string {
  const base = session.account.label;
  return `github-${sanitizeAccountKey(base)}`;
}

async function migrateLegacySyncedStorageIfNeeded(nextAccountKey: string): Promise<void> {
  const basePath = resolveSyncedNotesBasePath();
  const scopedPath = path.join(basePath, 'accounts', nextAccountKey);

  await fs.mkdir(basePath, { recursive: true });

  const scopedEntries = await fs.readdir(scopedPath, { withFileTypes: true }).catch(() => []);
  if (scopedEntries.length > 0) {
    return;
  }

  const baseEntries = await fs.readdir(basePath, { withFileTypes: true });
  const movable = baseEntries.filter((entry) => entry.name !== 'accounts');
  if (movable.length === 0) {
    return;
  }

  await fs.mkdir(scopedPath, { recursive: true });

  for (const entry of movable) {
    await fs.rename(path.join(basePath, entry.name), path.join(scopedPath, entry.name));
  }
}

export async function setActiveGitHubAccount(session: AuthenticationSession): Promise<string> {
  const config = vscode.workspace.getConfiguration();
  const previousKey = config.get<string>('devnotes.activeAccountKey', '').trim();
  const nextKey = toGitHubAccountKey(session);

  if (previousKey === nextKey) {
    return nextKey;
  }

  if (!previousKey) {
    await migrateLegacySyncedStorageIfNeeded(nextKey);
  }

  await config.update('devnotes.activeAccountKey', nextKey, vscode.ConfigurationTarget.Global);
  return nextKey;
}
