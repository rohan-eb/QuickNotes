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
        const syncProvider = config.get<string>('devnotes.syncProvider', 'github').trim();
        const driveToken = config.get<string>('devnotes.googleDriveAccessToken', '').trim();
        const session = await getGitHubSession(false);
        const githubConnected = Boolean(session) && activeAccountKey.length > 0 && syncProvider === 'github';
        const googleConnected = driveToken.length > 0 && activeAccountKey.length > 0 && syncProvider === 'googleDrive';
        const syncConnected = (githubConnected || googleConnected) && !localOnlyMode;
        const currentLabel = syncConnected
          ? (syncProvider === 'googleDrive' ? 'Google Drive' : session?.account.label || 'GitHub')
          : localOnlyMode
            ? 'Local-only mode'
            : 'Not connected';

        const picks = syncConnected
          ? [
              { label: 'Switch Account', value: 'switch', detail: 'Switch connected provider/account' },
              { label: 'Disconnect Account', value: 'disconnect', detail: 'Disable sync and continue local-only' }
            ]
          : [
              { label: 'Connect GitHub', value: 'connect-github', detail: 'Sign in with GitHub' },
              { label: 'Connect Google Drive', value: 'connect-google', detail: 'Sign in with Google Drive' }
            ];

        const selected = await vscode.window.showQuickPick(
          picks,
          { placeHolder: `Account actions (current: ${currentLabel})` }
        );

        if (!selected) {
          return;
        }

        if (selected.value === 'connect-github') {
          await vscode.commands.executeCommand('devnotes.connectAccount');
          return;
        }

        if (selected.value === 'connect-google') {
          await vscode.commands.executeCommand('devnotes.connectGoogleDrive');
          return;
        }

        if (selected.value === 'switch') {
          const provider = await vscode.window.showQuickPick(
            [
              { label: 'GitHub', value: 'github', detail: 'Use GitHub as active sync provider' },
              { label: 'Google Drive', value: 'googleDrive', detail: 'Use Google Drive as active sync provider' }
            ],
            { placeHolder: 'Select sync provider' }
          );
          if (!provider) {
            return;
          }
          if (provider.value === 'googleDrive') {
            await vscode.commands.executeCommand('devnotes.connectGoogleDrive');
          } else {
            await vscode.commands.executeCommand('devnotes.switchAccount');
          }
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
