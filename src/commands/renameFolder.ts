import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FolderItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

export function registerRenameFolderCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.renameFolder', async (item: FolderItem) => {
      try {
        if (!item) {
          return;
        }

        const parentDir = path.dirname(item.fullPath);
        const nextName = await vscode.window.showInputBox({
          prompt: 'Rename folder',
          value: item.label
        });

        if (!nextName) {
          return;
        }

        const trimmed = nextName.trim();
        if (!trimmed || trimmed === item.label) {
          return;
        }

        const nextPath = path.join(parentDir, trimmed);
        await fs.rename(item.fullPath, nextPath);
        await maybeAutoSyncForPath(item.fullPath);
        await maybeAutoSyncForPath(nextPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to rename folder', error);
        vscode.window.showErrorMessage('Unable to rename folder.');
      }
    })
  );
}
