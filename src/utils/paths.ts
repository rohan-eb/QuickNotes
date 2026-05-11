import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function resolveHomePath(configuredPath: string): string {
  if (configuredPath.startsWith('~/')) {
    return path.join(os.homedir(), configuredPath.slice(2));
  }

  return configuredPath;
}

export function resolveSyncedNotesPath(): string {
  const basePath = vscode.workspace
    .getConfiguration()
    .get<string>('devnotes.syncedNotesPath', vscode.workspace.getConfiguration().get<string>('devnotes.notesPath', '~/.devnotes'));

  const resolvedBasePath = resolveHomePath(basePath);
  const activeAccountKey = vscode.workspace.getConfiguration().get<string>('devnotes.activeAccountKey', '').trim();

  if (!activeAccountKey) {
    return resolvedBasePath;
  }

  return path.join(resolvedBasePath, 'accounts', activeAccountKey);
}

export function resolveSyncedNotesBasePath(): string {
  const configuredPath = vscode.workspace
    .getConfiguration()
    .get<string>('devnotes.syncedNotesPath', vscode.workspace.getConfiguration().get<string>('devnotes.notesPath', '~/.devnotes'));

  return resolveHomePath(configuredPath);
}

export function resolveLocalNotesPath(): string {
  const configuredPath = vscode.workspace
    .getConfiguration()
    .get<string>('devnotes.localNotesPath', '~/.devnotes-local');

  return resolveHomePath(configuredPath);
}

// Backward compatibility with existing code paths.
export function resolveNotesPath(): string {
  return resolveSyncedNotesPath();
}
