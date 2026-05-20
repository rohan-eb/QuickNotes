import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NoteItem, NoteSpace } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { ensureConnectedSessionForSyncedAction } from './connectAccount';
import { closeOpenTabForFile } from '../utils/editorCleanup';
import { logError } from '../utils/logger';
import { relocateLinkedImagesForMovedNote } from '../utils/markdownImages';
import { ensureSyncedNoteMetadata } from '../utils/noteMetadata';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

function rootForSpace(space: NoteSpace): string {
  return space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
}

async function listFoldersRecursively(rootDir: string): Promise<string[]> {
  const result: string[] = [rootDir];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'assets' || entry.name === 'accounts') {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    result.push(...(await listFoldersRecursively(fullPath)));
  }
  return result;
}

export function registerMoveNoteToFolderCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.moveNoteToFolder', async (item: NoteItem) => {
      try {
        if (!item) {
          return;
        }

        const localRoot = rootForSpace('local');
        const syncedRoot = rootForSpace('synced');
        const [localFolders, syncedFolders] = await Promise.all([
          listFoldersRecursively(localRoot),
          listFoldersRecursively(syncedRoot)
        ]);
        const currentDir = path.dirname(item.fullPath);
        const destinationFolders = [
          ...localFolders.map((folderPath) => ({ folderPath, space: 'local' as const })),
          ...syncedFolders.map((folderPath) => ({ folderPath, space: 'synced' as const }))
        ].filter(({ folderPath }) => path.resolve(folderPath) !== path.resolve(currentDir));

        const picks: Array<
          | (vscode.QuickPickItem & { folderPath?: undefined; space?: undefined })
          | (vscode.QuickPickItem & { folderPath: string; space: NoteSpace })
        > = [];

        const syncedTargets = destinationFolders.filter((entry) => entry.space === 'synced');
        const localTargets = destinationFolders.filter((entry) => entry.space === 'local');

        if (syncedTargets.length > 0) {
          picks.push({ label: 'Synced Notes', kind: vscode.QuickPickItemKind.Separator });
          picks.push(
            ...syncedTargets.map(({ folderPath, space }) => ({
              label: path.relative(syncedRoot, folderPath) || '(root)',
              description: 'Synced Notes',
              folderPath,
              space
            }))
          );
        }

        if (localTargets.length > 0) {
          picks.push({ label: 'Local Notes', kind: vscode.QuickPickItemKind.Separator });
          picks.push(
            ...localTargets.map(({ folderPath, space }) => ({
              label: path.relative(localRoot, folderPath) || '(root)',
              description: 'Local Notes',
              folderPath,
              space
            }))
          );
        }

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `Move ${item.fileName} to which folder?`
        });

        if (!selected || !('folderPath' in selected) || !selected.folderPath || !selected.space) {
          return;
        }

        if (selected.space === 'synced' && item.space !== 'synced') {
          const connectedSession = await ensureConnectedSessionForSyncedAction(notesProvider, {
            cancelMessage: 'Account connection was canceled. Note move was not completed.'
          });
          if (!connectedSession) {
            return;
          }
        }

        const destinationPath = path.join(selected.folderPath, path.basename(item.fullPath));
        const originalPath = item.fullPath;
        await closeOpenTabForFile(originalPath);
        await fs.rename(item.fullPath, destinationPath);
        await relocateLinkedImagesForMovedNote(originalPath, destinationPath);
        if (selected.space === 'synced') {
          await ensureSyncedNoteMetadata(destinationPath, {
            source: item.space === 'local' ? 'vscode' : undefined,
            forceUpdatedAt: item.space === 'local'
          });
        }
        await maybeAutoSyncForPath(item.fullPath);
        await maybeAutoSyncForPath(destinationPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to move note to folder', error);
        vscode.window.showErrorMessage('Unable to move note to selected folder.');
      }
    })
  );
}
