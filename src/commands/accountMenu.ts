import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { logError } from '../utils/logger';

export function registerAccountMenuCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.accountMenu', async () => {
      try {
        const config = vscode.workspace.getConfiguration();
        const localOnlyMode = config.get<boolean>('devnotes.localOnlyMode', false);
        const activeAccountKey = config.get<string>('devnotes.activeAccountKey', '').trim();
        const session = await getGitHubSession(false);
        const syncConnected = Boolean(session) && !localOnlyMode && activeAccountKey.length > 0;
        const currentLabel = syncConnected ? session!.account.label : localOnlyMode ? 'Local-only mode' : 'Not connected';

        const picks = syncConnected
          ? [
              { label: 'Switch Account', value: 'switch', detail: 'Connect a different GitHub account' },
              { label: 'Disconnect Account', value: 'disconnect', detail: 'Disable sync and continue local-only' }
            ]
          : [
              { label: 'Connect Account', value: 'connect', detail: 'Sign in with GitHub' }
            ];

        const selected = await vscode.window.showQuickPick(
          picks,
          { placeHolder: `Account actions (current: ${currentLabel})` }
        );

        if (!selected) {
          return;
        }

        if (selected.value === 'connect') {
          await vscode.commands.executeCommand('devnotes.connectAccount');
          return;
        }

        if (selected.value === 'switch') {
          if (!syncConnected) {
            await vscode.commands.executeCommand('devnotes.connectAccount');
            return;
          }
          await vscode.commands.executeCommand('devnotes.switchAccount');
          return;
        }

        if (!syncConnected) {
          await vscode.window.showInformationMessage('No connected account to disconnect.');
          return;
        }

        await vscode.commands.executeCommand('devnotes.disconnectAccount');
      } catch (error) {
        logError('Failed to open account menu', error);
        vscode.window.showErrorMessage('Unable to open account actions right now.');
      }
    })
  );
}
