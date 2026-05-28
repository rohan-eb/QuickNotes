import * as vscode from 'vscode';
import { connectGoogleDriveOAuth } from '../googleDrive/auth';
import { logError } from '../utils/logger';

export function registerConnectGoogleDriveCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.connectGoogleDrive', async () => {
      try {
        await connectGoogleDriveOAuth();
        vscode.window.showInformationMessage('Google Drive connected. QuickNotes will use Google Drive sync.');
      } catch (error) {
        logError('Failed to connect Google Drive', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to connect Google Drive right now. ${reason}`);
      }
    })
  );
}
