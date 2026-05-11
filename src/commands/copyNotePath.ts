import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';

export function registerCopyNotePathCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.copyNotePath', async (item: NoteItem) => {
      try {
        await vscode.env.clipboard.writeText(item.fullPath);
        vscode.window.showInformationMessage('Note path copied to clipboard.');
      } catch (error) {
        logError('Failed to copy note path', error);
        vscode.window.showErrorMessage('Unable to copy note path.');
      }
    })
  );
}
