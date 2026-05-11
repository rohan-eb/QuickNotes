import * as vscode from 'vscode';
import { logError } from '../utils/logger';

export function registerCreateNoteQuickCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.createNoteQuick', async () => {
      try {
        const selected = await vscode.window.showQuickPick(
          [
            { label: 'Synced Note', value: 'synced', detail: 'Backed up to connected account' },
            { label: 'Local Note', value: 'local', detail: 'Stored only on this machine' }
          ],
          { placeHolder: 'Create note in which space?' }
        );

        if (!selected) {
          return;
        }

        await vscode.commands.executeCommand('devnotes.createNote', selected.value);
      } catch (error) {
        logError('Failed to run quick create note', error);
        vscode.window.showErrorMessage('Unable to create note right now.');
      }
    })
  );
}
