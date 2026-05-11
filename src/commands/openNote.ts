import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';

export function registerOpenNoteCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.openNote', async (item: NoteItem) => {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
        await vscode.window.showTextDocument(doc);
      } catch (error) {
        logError('Failed to open note', error);
        vscode.window.showErrorMessage('Unable to open note.');
      }
    })
  );
}
