import * as vscode from 'vscode';

export function registerConnectGitHubCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.connectGitHub', async () => {
      // Legacy command alias: route users to the unified connect flow.
      await vscode.commands.executeCommand('devnotes.connectAccount');
    })
  );
}
