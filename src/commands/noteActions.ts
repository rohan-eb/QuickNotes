import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';

type ActionKey =
  | 'duplicate'
  | 'insertImage'
  | 'reveal';

const ACTION_TO_COMMAND: Record<ActionKey, string> = {
  duplicate: 'devnotes.duplicateNote',
  insertImage: 'devnotes.insertImageIntoNote',
  reveal: 'devnotes.revealNoteInFolder'
};

export function registerNoteActionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.noteActions', async (item: NoteItem) => {
      try {
        if (!item) {
          return;
        }

        const actions: Array<{ label: string; value: ActionKey }> = [
          { label: 'Duplicate', value: 'duplicate' },
          { label: 'Insert Image', value: 'insertImage' },
          { label: 'Reveal in Folder', value: 'reveal' }
        ];

        const selected = await vscode.window.showQuickPick(actions, {
          placeHolder: `More actions for ${item.fileName}`
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
