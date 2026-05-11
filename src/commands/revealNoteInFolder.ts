import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';

export function registerRevealNoteInFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.revealNoteInFolder', async (item: NoteItem) => {
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fullPath));
      } catch (error) {
        logError('Failed to reveal note in folder', error);
        vscode.window.showErrorMessage('Unable to reveal note in folder.');
      }
    })
  );
}
