import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { restoreNotesFromGitHub } from '../github/restore';
import { logError } from '../utils/logger';

export function registerRestoreNotesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.restoreNotes', async () => {
      try {
        const session = await getGitHubSession(true);
        if (!session) {
          vscode.window.showWarningMessage('GitHub authentication is required to restore notes.');
          return;
        }

        const result = await restoreNotesFromGitHub(session);
        if (!result.restored) {
          vscode.window.showInformationMessage(result.reason ?? 'No remote notes found to restore yet.');
          return;
        }

        vscode.window.showInformationMessage('Notes restore completed.');
      } catch (error) {
        logError('Failed to restore notes', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to restore notes right now. ${reason}`);
      }
    })
  );
}
