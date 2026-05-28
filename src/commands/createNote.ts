import * as vscode from 'vscode';
import { createNoteFileInDirectory } from '../storage/localStorage';
import { NoteSpace } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { ensureConnectedSessionForSyncedAction } from './connectAccount';
import { logError } from '../utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

function getDefaultSpace(): NoteSpace {
  const configured = vscode.workspace.getConfiguration().get<string>('devnotes.defaultNoteSpace', 'local');
  return configured === 'synced' ? 'synced' : 'local';
}

export function registerCreateNoteCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.createNote', async (arg?: unknown) => {
      try {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter note name',
          placeHolder: 'ideas.md'
        });

        if (!input) {
          return;
        }

        const spaceFromArg =
          typeof arg === 'string'
            ? arg
            : arg && typeof arg === 'object' && 'space' in arg
              ? String((arg as { space?: unknown }).space)
              : undefined;
        const targetDirFromArg =
          arg && typeof arg === 'object' && 'fullPath' in arg ? String((arg as { fullPath?: unknown }).fullPath) : undefined;

        const space = spaceFromArg === 'synced' || spaceFromArg === 'local' ? spaceFromArg : getDefaultSpace();

        if (space === 'synced') {
          const connectedSession = await ensureConnectedSessionForSyncedAction(notesProvider, {
            cancelMessage: 'Account connection was canceled. Synced note was not created.'
          });

          if (!connectedSession) {
            return;
          }
        }

        const defaultDir = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
        const targetDir = targetDirFromArg && targetDirFromArg.length > 0 ? targetDirFromArg : defaultDir;

        const fullPath = await createNoteFileInDirectory(targetDir, input, {
          includeMetadata: space === 'synced',
          source: 'vscode'
        });

        await maybeAutoSyncForPath(fullPath);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
        await vscode.window.showTextDocument(doc);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to create note', error);
        vscode.window.showErrorMessage('Unable to create note. Check if note name already exists.');
      }
    })
  );
}
