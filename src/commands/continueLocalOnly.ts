import * as vscode from 'vscode';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';

export function registerContinueLocalOnlyCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.continueLocalOnly', async () => {
      try {
        const config = vscode.workspace.getConfiguration();
        await config.update('devnotes.localOnlyMode', true, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.autoSync', false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('QuickNotes is set to local-only mode.');
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to enable local-only mode', error);
        vscode.window.showErrorMessage('Unable to switch to local-only mode right now.');
      }
    })
  );
}
