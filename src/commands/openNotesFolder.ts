import * as vscode from 'vscode';
import { ensureDirectory } from '../storage/localStorage';
import { logError } from '../utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';

export function registerOpenNotesFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.openNotesFolder', async () => {
      try {
        const picks = [
          { label: 'Synced Notes Folder', path: resolveSyncedNotesPath() },
          { label: 'Local Notes Folder', path: resolveLocalNotesPath() }
        ];

        const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Choose notes folder to open' });
        if (!selected) {
          return;
        }

        await ensureDirectory(selected.path);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(selected.path));
      } catch (error) {
        logError('Failed to open notes folder', error);
        vscode.window.showErrorMessage('Unable to open notes folder.');
      }
    })
  );
}
