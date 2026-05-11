import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveSyncedNotesPath } from './paths';

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function maybeAutoSyncForPath(filePath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const autoSync = config.get<boolean>('devnotes.autoSync', true);
  const localOnlyMode = config.get<boolean>('devnotes.localOnlyMode', false);
  const syncedRoot = resolveSyncedNotesPath();

  if (!autoSync || localOnlyMode || !isInsideDirectory(filePath, syncedRoot)) {
    return;
  }

  await vscode.commands.executeCommand('devnotes.syncNotes');
}
