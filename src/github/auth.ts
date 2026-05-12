import * as vscode from 'vscode';

type GitHubSessionOptions = {
  forceNewSession?: boolean;
  preferredAccountLabel?: string;
};

function getConfiguredPreferredAccountLabel(): string {
  return vscode.workspace.getConfiguration().get<string>('devnotes.activeAccountLabel', '').trim();
}

async function resolvePreferredAccount(
  preferredAccountLabel?: string
): Promise<vscode.AuthenticationSessionAccountInformation | undefined> {
  const preferredLabel = preferredAccountLabel?.trim() || getConfiguredPreferredAccountLabel();
  if (!preferredLabel) {
    return undefined;
  }

  const accounts = await vscode.authentication.getAccounts('github');
  return accounts.find((account) => account.label === preferredLabel);
}

export async function getGitHubSession(
  createIfNone: boolean,
  options?: GitHubSessionOptions
): Promise<vscode.AuthenticationSession | undefined> {
  if (options?.forceNewSession) {
    try {
      // Preferred: ask GitHub auth to force an account selection/new session.
      return await vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
        forceNewSession: true
      });
    } catch {
      // Fallback for environments where forceNewSession is unsupported.
      // Do NOT clear session preference here, otherwise pressing Esc in the
      // account chooser can make QuickNotes look disconnected.
      return vscode.authentication.getSession('github', ['repo'], {
        createIfNone
      });
    }
  }

  try {
    const preferredAccount = await resolvePreferredAccount(options?.preferredAccountLabel);
    if (preferredAccount) {
      return await vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
        forceNewSession: false,
        account: preferredAccount
      });
    }

    return await vscode.authentication.getSession('github', ['repo'], {
      createIfNone,
      forceNewSession: false
    });
  } catch (error) {
    if (!createIfNone) {
      return undefined;
    }
    throw error;
  }
}
