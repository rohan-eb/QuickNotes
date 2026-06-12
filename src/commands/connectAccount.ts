import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import {
  beginInitialSyncTransition,
  endInitialSyncTransition,
  invalidateSyncContext,
  waitForCurrentSyncToFinish
} from './syncNotes';
import { ensureDirectory } from '../storage/localStorage';
import { NotesProvider } from '../tree/notesProvider';
import { setActiveGitHubAccount } from '../utils/accountScope';
import { closeOpenTabsUnderDirectory } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { resolveSyncedNotesPath } from '../utils/paths';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function activateConnectedSession(
  session: vscode.AuthenticationSession
): Promise<void> {
  invalidateSyncContext();
  const previousSyncedPath = resolveSyncedNotesPath();
  await setActiveGitHubAccount(session);
  await closeOpenTabsUnderDirectory(previousSyncedPath);
  await ensureDirectory(resolveSyncedNotesPath());

  const config = vscode.workspace.getConfiguration();
  await config.update('devnotes.syncProvider', 'github', vscode.ConfigurationTarget.Global);
  await config.update('devnotes.activeAccountLabel', session.account.label, vscode.ConfigurationTarget.Global);
  await config.update('devnotes.localOnlyMode', false, vscode.ConfigurationTarget.Global);
  await config.update('devnotes.autoSync', true, vscode.ConfigurationTarget.Global);
}

async function pickGitHubSession(
  currentSession?: vscode.AuthenticationSession
): Promise<vscode.AuthenticationSession | undefined> {
  const accounts = await vscode.authentication.getAccounts('github');
  const picks: Array<
    | vscode.QuickPickItem & { kind?: undefined; account?: vscode.AuthenticationSessionAccountInformation }
    | { label: string; kind: vscode.QuickPickItemKind; account?: undefined }
  > = accounts.map((account) => ({
    label: account.label,
    description: currentSession?.account.label === account.label ? 'Current account' : undefined,
    account
  }));

  if (picks.length > 0) {
    picks.push({ label: 'separator', kind: vscode.QuickPickItemKind.Separator });
  }

  picks.push({
    label: 'Connect New GitHub Account',
    description: 'Sign in with another GitHub account'
  });

  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: 'Select GitHub account to connect'
  });

  if (!selected) {
    return undefined;
  }

  if ('account' in selected && selected.account) {
    const selectedSession = await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: true,
      account: selected.account
    });

    // Defensive check: some environments may still return the current preferred
    // session. If user selected a different account, force account re-selection.
    if (
      currentSession &&
      currentSession.account.label !== selected.account.label &&
      selectedSession.account.label !== selected.account.label
    ) {
      return vscode.authentication.getSession('github', ['repo'], {
        createIfNone: true,
        clearSessionPreference: true
      });
    }

    return selectedSession;
  }

  return vscode.authentication.getSession('github', ['repo'], {
    createIfNone: true,
    clearSessionPreference: true
  });
}

async function runInitialSyncAfterConnect(
  notesProvider: NotesProvider,
  accountLabel: string
): Promise<void> {
  beginInitialSyncTransition(`Syncing QuickNotes with GitHub for ${accountLabel}...`);
  notesProvider.refresh();

  try {
    await waitForCurrentSyncToFinish();

    try {
      await vscode.commands.executeCommand('devnotes.syncNotes', { silent: true });
      return;
    } catch (error) {
      logError('Initial post-connect sync attempt failed', error);
    }

    await delay(1500);
    await vscode.commands.executeCommand('devnotes.syncNotes', { silent: true });
  } catch (error) {
    logError('Retry post-connect sync attempt failed', error);
  } finally {
    endInitialSyncTransition();
    notesProvider.refresh();
  }
}

export async function connectAccountInteractive(
  notesProvider: NotesProvider,
  options?: { currentSession?: vscode.AuthenticationSession; successMessage?: string; cancelMessage?: string }
): Promise<vscode.AuthenticationSession | undefined> {
  const session = await pickGitHubSession(options?.currentSession);

  if (!session) {
    if (options?.cancelMessage) {
      vscode.window.showWarningMessage(options.cancelMessage);
    }
    return undefined;
  }

  await activateConnectedSession(session);
  notesProvider.refresh();
  void runInitialSyncAfterConnect(notesProvider, session.account.label);

  if (options?.successMessage) {
    vscode.window.showInformationMessage(options.successMessage.replace('{account}', session.account.label));
  }

  notesProvider.refresh();
  return session;
}

export async function ensureConnectedSessionForSyncedAction(
  notesProvider: NotesProvider,
  options?: { currentSession?: vscode.AuthenticationSession; cancelMessage?: string }
): Promise<vscode.AuthenticationSession | undefined> {
  const config = vscode.workspace.getConfiguration();
  const localOnlyMode = config.get<boolean>('devnotes.localOnlyMode', false);
  const activeAccountKey = config.get<string>('devnotes.activeAccountKey', '').trim();
  const currentSession = options?.currentSession ?? await getGitHubSession(false);
  const syncConnected = Boolean(currentSession) && !localOnlyMode && activeAccountKey.length > 0;

  if (syncConnected) {
    return currentSession;
  }

  return connectAccountInteractive(notesProvider, {
    currentSession,
    cancelMessage: options?.cancelMessage ?? 'Account connection was canceled.'
  });
}

export function registerConnectAccountCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.connectAccount', async () => {
      try {
        const currentSession = await getGitHubSession(false);
        await connectAccountInteractive(notesProvider, {
          currentSession,
          successMessage: 'GitHub connected: {account}',
          cancelMessage: 'GitHub authentication was not completed.'
        });
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
        const currentSession = await getGitHubSession(false);
        const session = await connectAccountInteractive(notesProvider, {
          currentSession,
          successMessage: 'GitHub active account: {account}',
          cancelMessage: 'GitHub account switch was not completed.'
        });

        if (!session) {
          return;
        }
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

        invalidateSyncContext();
        const config = vscode.workspace.getConfiguration();
        await config.update('devnotes.activeAccountKey', '', vscode.ConfigurationTarget.Global);
        await config.update('devnotes.activeAccountLabel', '', vscode.ConfigurationTarget.Global);
        await config.update('devnotes.localOnlyMode', true, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.autoSync', false, vscode.ConfigurationTarget.Global);
        await config.update('devnotes.googleDriveAccessToken', '', vscode.ConfigurationTarget.Global);
        await config.update('devnotes.googleDriveRefreshToken', '', vscode.ConfigurationTarget.Global);
        await config.update('devnotes.googleDriveTokenExpiry', 0, vscode.ConfigurationTarget.Global);

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
