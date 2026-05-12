import * as vscode from 'vscode';

export function registerSetupNoteHubCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.setupNoteHub', async () => {
      // Legacy command alias: route users to the unified connect flow.
      await vscode.commands.executeCommand('devnotes.connectAccount');
    })
  );
}
