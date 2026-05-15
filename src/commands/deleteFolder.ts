import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { FolderItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { closeOpenTabsUnderDirectory } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

export function registerDeleteFolderCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.deleteFolder', async (item: FolderItem) => {
      try {
        if (!item) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Delete folder "${item.label}" and all files inside it?`,
          { modal: true },
          'Delete Folder'
        );

        if (confirmed !== 'Delete Folder') {
          return;
        }

        await closeOpenTabsUnderDirectory(item.fullPath);
        await fs.rm(item.fullPath, { recursive: true, force: false });
        await maybeAutoSyncForPath(item.fullPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to delete folder', error);
        vscode.window.showErrorMessage('Unable to delete folder.');
      }
    })
  );
}
