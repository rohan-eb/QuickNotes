import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initializeLogger(): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('QuickNotes');
  }
}

export function logInfo(message: string): void {
  outputChannel?.appendLine(`[INFO] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const details = error instanceof Error ? error.stack ?? error.message : String(error ?? '');
  outputChannel?.appendLine(`[ERROR] ${message}`);
  if (details) {
    outputChannel?.appendLine(details);
  }
}
