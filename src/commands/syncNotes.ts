import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { syncNotesWithGitHub } from '../github/gitSync';
import { logError } from '../utils/logger';

function toUserFriendlySyncError(reason: string): string {
  const lower = reason.toLowerCase();

  if (
    lower.includes('eai_again') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('could not resolve host') ||
    lower.includes('could not read from remote repository') ||
    lower.includes('network is unreachable')
  ) {
    return 'No internet connection or GitHub is unreachable. Your notes are saved locally; reconnect and sync again.';
  }

  if (lower.includes('authentication') || lower.includes('401') || lower.includes('403')) {
    return 'GitHub authentication failed or expired. Reconnect your GitHub account and try syncing again.';
  }

  if (lower.includes('sync conflict detected')) {
    return reason;
  }

  return `Unable to sync notes right now. ${reason}`;
}

export function registerSyncNotesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.syncNotes', async (arg?: unknown) => {
      try {
        const silent = Boolean(
          arg &&
          typeof arg === 'object' &&
          'silent' in arg &&
          (arg as { silent?: unknown }).silent
        );

        const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
        if (localOnlyMode) {
          if (!silent) {
            vscode.window.showInformationMessage('Local-only mode is enabled. Disable it to sync notes.');
          }
          return;
        }

        // Silent/background sync must never trigger interactive auth prompts.
        const session = await getGitHubSession(!silent);
        if (!session) {
          if (!silent) {
            vscode.window.showWarningMessage('GitHub authentication is required to sync notes.');
          }
          return;
        }

        await syncNotesWithGitHub(session);
        if (!silent) {
          vscode.window.showInformationMessage(`Notes sync completed for ${session.account.label}.`);
        }
      } catch (error) {
        logError('Failed to sync notes', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        if (!arg || typeof arg !== 'object' || !(arg as { silent?: unknown }).silent) {
          vscode.window.showErrorMessage(toUserFriendlySyncError(reason));
        }
      }
    })
  );
}
