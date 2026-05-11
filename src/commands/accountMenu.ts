import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { logError } from '../utils/logger';

export function registerAccountMenuCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.accountMenu', async () => {
      try {
        const session = await getGitHubSession(false);
        const currentLabel = session ? session.account.label : 'Not connected';

        const selected = await vscode.window.showQuickPick(
          [
            { label: 'Switch Account', value: 'switch', detail: 'Connect a different provider/account' },
            { label: 'Disconnect Account', value: 'disconnect', detail: 'Disable sync and continue local-only' }
          ],
          { placeHolder: `Account actions (current: ${currentLabel})` }
        );

        if (!selected) {
          return;
        }

        if (selected.value === 'switch') {
          await vscode.commands.executeCommand('devnotes.switchAccount');
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
