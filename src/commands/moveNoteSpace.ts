import * as vscode from 'vscode';
import { moveNoteToDirectory } from '../storage/localStorage';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

const SYNCED_VISIBILITY_WARNING_KEY = 'devnotes.syncedVisibilityWarningAccepted';

async function moveNote(item: NoteItem, target: 'synced' | 'local', notesProvider: NotesProvider): Promise<void> {
  const targetDir = target === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
  const movedPath = await moveNoteToDirectory(item.fullPath, targetDir);
  await maybeAutoSyncForPath(item.fullPath);
  await maybeAutoSyncForPath(movedPath);
  notesProvider.refresh();
}

async function ensureSyncedVisibilityWarningAccepted(context: vscode.ExtensionContext): Promise<boolean> {
  const alreadyAccepted = context.globalState.get<boolean>(SYNCED_VISIBILITY_WARNING_KEY, false);
  if (alreadyAccepted) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    'Synced notes can be visible to anyone with access to this connected account/repository.',
    { modal: true },
    'Move to Synced',
    'Cancel'
  );

  if (choice !== 'Move to Synced') {
    return false;
  }

  await context.globalState.update(SYNCED_VISIBILITY_WARNING_KEY, true);
  return true;
}

export function registerMoveNoteSpaceCommands(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.moveNoteToSynced', async (item: NoteItem) => {
      try {
        if (!item || item.space === 'synced') {
          return;
        }

        const accepted = await ensureSyncedVisibilityWarningAccepted(context);
        if (!accepted) {
          return;
        }

        await moveNote(item, 'synced', notesProvider);
      } catch (error) {
        logError('Failed to move note to synced space', error);
        vscode.window.showErrorMessage('Unable to move note to synced space.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.moveNoteToLocal', async (item: NoteItem) => {
      try {
        if (!item || item.space === 'local') {
          return;
        }

        await moveNote(item, 'local', notesProvider);
      } catch (error) {
        logError('Failed to move note to local space', error);
        vscode.window.showErrorMessage('Unable to move note to local space.');
      }
    })
  );
}
