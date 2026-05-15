import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NotesProvider } from '../tree/notesProvider';
import { NoteSpace } from '../tree/noteItem';
import { ensureConnectedSessionForSyncedAction } from './connectAccount';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';
import { logError } from '../utils/logger';

function getDefaultSpace(): NoteSpace {
  const configured = vscode.workspace.getConfiguration().get<string>('devnotes.defaultNoteSpace', 'local');
  return configured === 'synced' ? 'synced' : 'local';
}

export function registerCreateFolderCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.createFolder', async (arg?: unknown) => {
      try {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter folder name',
          placeHolder: 'project-name'
        });
        if (!input) {
          return;
        }

        const folderName = input.trim();
        if (!folderName) {
          return;
        }

        const spaceFromArg =
          arg && typeof arg === 'object' && 'space' in arg
            ? String((arg as { space?: unknown }).space)
            : typeof arg === 'string'
              ? arg
              : undefined;
        const parentDirFromArg =
          arg && typeof arg === 'object' && 'fullPath' in arg ? String((arg as { fullPath?: unknown }).fullPath) : undefined;

        const space = spaceFromArg === 'synced' || spaceFromArg === 'local' ? spaceFromArg : getDefaultSpace();

        if (space === 'synced') {
          const connectedSession = await ensureConnectedSessionForSyncedAction(notesProvider, {
            cancelMessage: 'Account connection was canceled. Folder was not created.'
          });
          if (!connectedSession) {
            return;
          }
        }

        const defaultParent = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
        const parentDir = parentDirFromArg && parentDirFromArg.length > 0 ? parentDirFromArg : defaultParent;
        const targetPath = path.join(parentDir, folderName);
        await fs.mkdir(targetPath, { recursive: false });
        await maybeAutoSyncForPath(targetPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to create folder', error);
        vscode.window.showErrorMessage('Unable to create folder. Check if folder already exists.');
      }
    })
  );
}
