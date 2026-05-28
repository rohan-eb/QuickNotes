import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { renameNoteByPath } from '../storage/localStorage';
import { NoteItem } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { closeOpenTabForFile } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

const ARCHIVE_DIRECTORY_NAME = '.quicknotes-archive';

function isInternalDirectory(name: string): boolean {
  return name === '.git' || name === 'assets' || name === 'accounts' || name === ARCHIVE_DIRECTORY_NAME;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findMatchingNotePaths(rootDir: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];

  const visit = async (dirPath: string): Promise<void> => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (isInternalDirectory(entry.name)) {
          continue;
        }
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  };

  await visit(rootDir);
  return matches;
}

async function resolveExistingNotePath(item: NoteItem): Promise<string> {
  if (await pathExists(item.fullPath)) {
    return item.fullPath;
  }

  const [localMatches, syncedMatches] = await Promise.all([
    findMatchingNotePaths(resolveLocalNotesPath(), item.fileName),
    findMatchingNotePaths(resolveSyncedNotesPath(), item.fileName)
  ]);
  const matches = [...localMatches, ...syncedMatches];

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error('The selected note file could not be found in its expected location.');
}

export function registerRenameNoteCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.renameNote', async (item: NoteItem) => {
      try {
        if (!item) {
          vscode.window.showWarningMessage('Select a note in the QuickNotes sidebar to rename it.');
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: 'Rename note',
          value: item.fileName
        });

        if (!newName) {
          return;
        }

        const sourcePath = await resolveExistingNotePath(item);
        await closeOpenTabForFile(sourcePath);
        const newPath = await renameNoteByPath(sourcePath, newName);
        await maybeAutoSyncForPath(newPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to rename note', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to rename note. ${reason}`);
      }
    })
  );
}
