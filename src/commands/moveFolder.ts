import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FolderItem, NoteSpace } from '../tree/noteItem';
import { NotesProvider } from '../tree/notesProvider';
import { ensureConnectedSessionForSyncedAction } from './connectAccount';
import { logError } from '../utils/logger';
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

function isInsideDirectory(target: string, candidateParent: string): boolean {
  const rel = path.relative(path.resolve(candidateParent), path.resolve(target));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function registerMoveFolderCommand(context: vscode.ExtensionContext, notesProvider: NotesProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.moveFolder', async (item: FolderItem) => {
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
        const source = path.resolve(item.fullPath);
        const destinationFolders = [
          ...localFolders.map((folderPath) => ({ folderPath, space: 'local' as const })),
          ...syncedFolders.map((folderPath) => ({ folderPath, space: 'synced' as const }))
        ].filter(({ folderPath }) => {
          const resolved = path.resolve(folderPath);
          if (resolved === source) {
            return false;
          }
          if (isInsideDirectory(resolved, source)) {
            return false;
          }
          return true;
        });

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
          placeHolder: `Move folder ${item.label} to which destination?`
        });

        if (!selected || !('folderPath' in selected) || !selected.folderPath || !selected.space) {
          return;
        }

        if (selected.space === 'synced' && item.space !== 'synced') {
          const connectedSession = await ensureConnectedSessionForSyncedAction(notesProvider, {
            cancelMessage: 'Account connection was canceled. Folder move was not completed.'
          });
          if (!connectedSession) {
            return;
          }
        }

        const destinationPath = path.join(selected.folderPath, path.basename(item.fullPath));
        await fs.rename(item.fullPath, destinationPath);
        await maybeAutoSyncForPath(item.fullPath);
        await maybeAutoSyncForPath(destinationPath);
        notesProvider.refresh();
      } catch (error) {
        logError('Failed to move folder', error);
        vscode.window.showErrorMessage('Unable to move folder to selected destination.');
      }
    })
  );
}
