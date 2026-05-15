import * as vscode from 'vscode';
import { deleteNoteByPath } from '../storage/localStorage';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { closeOpenTabForFile } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
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

        await closeOpenTabForFile(item.fullPath);
        await deleteNoteByPath(item.fullPath);
        await maybeAutoSyncForPath(item.fullPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to delete note', error);
        vscode.window.showErrorMessage('Unable to delete note.');
      }
    })
  );
}
