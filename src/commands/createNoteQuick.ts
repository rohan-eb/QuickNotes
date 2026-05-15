import * as vscode from 'vscode';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';

export function registerCreateNoteQuickCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.createNoteQuick', async () => {
      try {
        const selected = await vscode.window.showQuickPick(
          [
            { label: 'Synced Note', value: 'synced', detail: 'Backed up to connected account' },
            { label: 'Local Note', value: 'local', detail: 'Stored only on this machine' }
          ],
          { placeHolder: 'Create note in which space?' }
        );

        if (!selected) {
          return;
        }

        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === selected.value
            ? { space: selected.value, fullPath: selectedFolder.fullPath }
            : selected.value;

        await vscode.commands.executeCommand('devnotes.createNote', targetArg);
      } catch (error) {
        logError('Failed to run quick create note', error);
        vscode.window.showErrorMessage('Unable to create note right now.');
      }
    })
  );
}
