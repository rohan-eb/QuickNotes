import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { ensureDirectory } from '../storage/localStorage';
import { NotesProvider } from '../tree/notesProvider';
import { setActiveGitHubAccount } from '../utils/accountScope';
import { closeOpenTabsUnderDirectory } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { resolveSyncedNotesPath } from '../utils/paths';

export function registerConnectAccountCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.connectAccount', async () => {
      try {
        const provider = await vscode.window.showQuickPick(
          [
            { label: 'GitHub', value: 'github', detail: 'Available in V1' },
            { label: 'GitLab', value: 'gitlab', detail: 'Coming soon' },
            { label: 'Bitbucket', value: 'bitbucket', detail: 'Coming soon' }
          ],
          { placeHolder: 'Choose a git provider to connect' }
        );

        if (!provider) {
          return;
        }

        if (provider.value !== 'github') {
          vscode.window.showInformationMessage(`${provider.label} support is coming soon. You can continue in local-only mode.`);
          return;
        }

        const session = await getGitHubSession(true);

        if (!session) {
          vscode.window.showWarningMessage('GitHub authentication was not completed.');
          return;
        }

        const previousSyncedPath = resolveSyncedNotesPath();
        await setActiveGitHubAccount(session);
        await closeOpenTabsUnderDirectory(previousSyncedPath);
        await ensureDirectory(resolveSyncedNotesPath());

        const config = vscode.workspace.getConfiguration();
        await config.update('devnotes.localOnlyMode', false, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.autoSync', true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`GitHub connected: ${session.account.label}`);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to connect account', error);
        vscode.window.showErrorMessage('Unable to connect account right now.');
      }
    })
  );
}

export function registerSwitchAccountCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.switchAccount', async () => {
      try {
        // Direct flow: delegate account choice to VS Code's GitHub account chooser.
        const session = await getGitHubSession(true, { forceNewSession: true });

        if (!session) {
          vscode.window.showWarningMessage('GitHub account switch was not completed.');
          return;
        }

        const previousSyncedPath = resolveSyncedNotesPath();
        await setActiveGitHubAccount(session);
        await closeOpenTabsUnderDirectory(previousSyncedPath);
        await ensureDirectory(resolveSyncedNotesPath());

        const config = vscode.workspace.getConfiguration();
        await config.update('devnotes.localOnlyMode', false, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.autoSync', true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`GitHub active account: ${session.account.label}`);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to switch account', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to switch account right now. ${reason}`);
      }
    })
  );
}

export function registerDisconnectAccountCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.disconnectAccount', async () => {
      try {
        const confirmed = await vscode.window.showWarningMessage(
          'Disconnect QuickNotes sync and continue in local-only mode?',
          { modal: true },
          'Disconnect'
        );
        if (confirmed !== 'Disconnect') {
          return;
        }

        const config = vscode.workspace.getConfiguration();
        await config.update('devnotes.localOnlyMode', true, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.autoSync', false, vscode.ConfigurationTarget.Global);

        await closeOpenTabsUnderDirectory(resolveSyncedNotesPath());

        vscode.window.showInformationMessage('QuickNotes sync disconnected. Running in local-only mode.');
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to disconnect account', error);
        vscode.window.showErrorMessage('Unable to disconnect account right now.');
      }
    })
  );
}
