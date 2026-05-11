import * as vscode from 'vscode';
import { logError } from '../utils/logger';

const SYNCED_VISIBILITY_WARNING_KEY = 'devnotes.syncedVisibilityWarningAccepted';

export function registerResetSyncedWarningCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.resetSyncedWarning', async () => {
      try {
        await context.globalState.update(SYNCED_VISIBILITY_WARNING_KEY, false);
        vscode.window.showInformationMessage('Synced privacy warning has been reset for testing.');
      } catch (error) {
        logError('Failed to reset synced privacy warning', error);
        vscode.window.showErrorMessage('Unable to reset synced privacy warning.');
      }
    })
  );
}
