import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';

type ActionKey =
  | 'open'
  | 'rename'
  | 'delete'
  | 'duplicate'
  | 'insertImage'
  | 'reveal'
  | 'moveToFolder'
  | 'moveToSynced'
  | 'moveToLocal';

const ACTION_TO_COMMAND: Record<ActionKey, string> = {
  open: 'devnotes.openNote',
  rename: 'devnotes.renameNote',
  delete: 'devnotes.deleteNote',
  duplicate: 'devnotes.duplicateNote',
  insertImage: 'devnotes.insertImageIntoNote',
  reveal: 'devnotes.revealNoteInFolder',
  moveToFolder: 'devnotes.moveNoteToFolder',
  moveToSynced: 'devnotes.moveNoteToSynced',
  moveToLocal: 'devnotes.moveNoteToLocal'
};

export function registerNoteActionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.noteActions', async (item: NoteItem) => {
      try {
        if (!item) {
          return;
        }

        const actions: Array<{ label: string; value: ActionKey }> = [
          { label: 'Open', value: 'open' },
          { label: 'Rename', value: 'rename' },
          { label: 'Delete', value: 'delete' },
          { label: 'Duplicate', value: 'duplicate' },
          { label: 'Insert Image', value: 'insertImage' },
          { label: 'Reveal in Folder', value: 'reveal' },
          { label: 'Move to Folder', value: 'moveToFolder' }
        ];

        if (item.space === 'local') {
          actions.push({ label: 'Move to Synced', value: 'moveToSynced' });
        } else {
          actions.push({ label: 'Move to Local', value: 'moveToLocal' });
        }

        const selected = await vscode.window.showQuickPick(actions, {
          placeHolder: `Actions for ${item.fileName}`
        });

        if (!selected) {
          return;
        }

        await vscode.commands.executeCommand(ACTION_TO_COMMAND[selected.value], item);
      } catch (error) {
        logError('Failed to show note actions', error);
        vscode.window.showErrorMessage('Unable to open note actions right now.');
      }
    })
  );
}
