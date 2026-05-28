import * as vscode from 'vscode';
import * as path from 'node:path';
import { deleteNoteByPath } from '../storage/localStorage';
import { getValidGoogleDriveAccessToken } from '../googleDrive/auth';
import { deleteSyncedFileFromGoogleDrive } from '../googleDrive/driveSync';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { closeOpenTabForFile } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

export function registerDeleteNoteCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.deleteNote', async (item: NoteItem) => {
      try {
        const confirmed = await vscode.window.showWarningMessage(
          `Delete ${item.fileName}?`,
          { modal: true },
          'Delete'
        );

        if (confirmed !== 'Delete') {
          return;
        }

        const provider = vscode.workspace.getConfiguration().get<string>('devnotes.syncProvider', 'github');
        if (item.space === 'synced' && provider === 'googleDrive') {
          const syncedRoot = resolveSyncedNotesPath();
          const relativePath = path.relative(syncedRoot, item.fullPath).replace(/\\/g, '/');
          if (relativePath && !relativePath.startsWith('..')) {
            const accessToken = await getValidGoogleDriveAccessToken();
            if (accessToken) {
              await deleteSyncedFileFromGoogleDrive(accessToken, relativePath);
            }
          }
        }

        await closeOpenTabForFile(item.fullPath);
        await deleteNoteByPath(item.fullPath);
        await maybeAutoSyncForPath(item.fullPath);
        notesProvider.refresh();
        vscode.window.showInformationMessage(`Deleted ${item.fileName}.`);
      } catch (error) {
        logError('Failed to delete note', error);
        vscode.window.showErrorMessage('Unable to delete note.');
      }
    })
  );
}
