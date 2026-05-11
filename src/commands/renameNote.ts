import * as vscode from 'vscode';
import { renameNoteByPath } from '../storage/localStorage';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

export function registerRenameNoteCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.renameNote', async (item: NoteItem) => {
      try {
        const newName = await vscode.window.showInputBox({
          prompt: 'Rename note',
          value: item.fileName
        });

        if (!newName) {
          return;
        }

        const newPath = await renameNoteByPath(item.fullPath, newName);
        await maybeAutoSyncForPath(newPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to rename note', error);
        vscode.window.showErrorMessage('Unable to rename note.');
      }
    })
  );
}
