import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';
import { updateNotePinned } from '../utils/noteMetadata';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

export function registerTogglePinCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.togglePin', async (item: NoteItem) => {
      try {
        if (!item) {
          return;
        }

        const nextPinned = !item.pinned;
        await updateNotePinned(item.fullPath, nextPinned, {
          source: 'vscode',
          forceUpdatedAt: item.space === 'synced'
        });
        await maybeAutoSyncForPath(item.fullPath);
        notesProvider.refresh();
        vscode.window.showInformationMessage(nextPinned ? 'Note pinned.' : 'Note unpinned.');
      } catch (error) {
        logError('Failed to toggle note pin', error);
        vscode.window.showErrorMessage('Unable to update note pin.');
      }
    })
  );
}
