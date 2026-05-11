import * as vscode from 'vscode';

type GitHubSessionOptions = {
  forceNewSession?: boolean;
};

export async function getGitHubSession(
  createIfNone: boolean,
  options?: GitHubSessionOptions
): Promise<vscode.AuthenticationSession | undefined> {
  if (options?.forceNewSession) {
    try {
      // Preferred: ask provider to force an account selection/new session.
      return await vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
        forceNewSession: true
      });
    } catch {
      // Fallback for environments where forceNewSession is unsupported.
      return vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
        clearSessionPreference: true
      });
    }
  }

  return vscode.authentication.getSession('github', ['repo'], {
    createIfNone,
    forceNewSession: false
  });
}
