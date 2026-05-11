import * as path from 'node:path';
import * as vscode from 'vscode';
import { copyNoteByPath } from '../storage/localStorage';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { logError } from '../utils/logger';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

function suggestDuplicateName(fileName: string): string {
  const parsed = path.parse(fileName);
  return `${parsed.name}-copy${parsed.ext || '.md'}`;
}

export function registerDuplicateNoteCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.duplicateNote', async (item: NoteItem) => {
      try {
        const suggested = suggestDuplicateName(item.fileName);
        const newName = await vscode.window.showInputBox({
          prompt: 'Duplicate note as',
          value: suggested
        });

        if (!newName) {
          return;
        }

        const fullPath = await copyNoteByPath(item.fullPath, newName);
        await maybeAutoSyncForPath(fullPath);
        notesProvider.refresh();

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
        await vscode.window.showTextDocument(doc);
      } catch (error) {
        logError('Failed to duplicate note', error);
        vscode.window.showErrorMessage('Unable to duplicate note.');
      }
    })
  );
}
