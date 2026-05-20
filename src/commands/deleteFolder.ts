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
        await fs.rm(item.fullPath, { recursive: true, force: true });
        notesProvider.refresh();

        try {
          await maybeAutoSyncForPath(item.fullPath);
        } catch (syncError) {
          logError('Folder deleted but sync failed afterward', syncError);
          const reason = syncError instanceof Error ? syncError.message : 'Unknown sync error';
          vscode.window.showWarningMessage(`Folder deleted locally, but sync could not finish: ${reason}`);
        }
      } catch (error) {
        logError('Failed to delete folder', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to delete folder. ${reason}`);
      }
    })
  );
}
