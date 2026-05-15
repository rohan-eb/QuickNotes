import * as vscode from 'vscode';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';

export function registerCreateFolderQuickCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.createFolderQuick', async () => {
      try {
        const selected = await vscode.window.showQuickPick(
          [
            { label: 'Synced Folder', value: 'synced', detail: 'Backed up to connected account' },
            { label: 'Local Folder', value: 'local', detail: 'Stored only on this machine' }
          ],
          { placeHolder: 'Create folder in which space?' }
        );

        if (!selected) {
          return;
        }

        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === selected.value
            ? { space: selected.value, fullPath: selectedFolder.fullPath }
            : selected.value;

        await vscode.commands.executeCommand('devnotes.createFolder', targetArg);
      } catch (error) {
        logError('Failed to run quick create folder', error);
        vscode.window.showErrorMessage('Unable to create folder right now.');
      }
    })
  );
}
