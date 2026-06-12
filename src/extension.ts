import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  registerConnectAccountCommand,
  registerDisconnectAccountCommand,
  registerSwitchAccountCommand
} from './commands/connectAccount';
import { registerAccountMenuCommand } from './commands/accountMenu';
import { registerConnectGitHubCommand } from './commands/connectGitHub';
import { registerConnectGoogleDriveCommand } from './commands/connectGoogleDrive';
import { registerContinueLocalOnlyCommand } from './commands/continueLocalOnly';
import { registerCopyNotePathCommand } from './commands/copyNotePath';
import { registerCreateNoteCommand } from './commands/createNote';
import { registerCreateFolderCommand } from './commands/createFolder';
import { registerCreateFolderQuickCommand } from './commands/createFolderQuick';
import { registerCreateNoteQuickCommand } from './commands/createNoteQuick';
import { registerDeleteNoteCommand } from './commands/deleteNote';
import { registerDeleteFolderCommand } from './commands/deleteFolder';
import { registerDuplicateNoteCommand } from './commands/duplicateNote';
import { registerMoveNoteSpaceCommands } from './commands/moveNoteSpace';
import { registerMoveNoteToFolderCommand } from './commands/moveNoteToFolder';
import { registerMoveFolderCommand } from './commands/moveFolder';
import { registerNoteActionsCommand } from './commands/noteActions';
import { registerOpenNoteCommand } from './commands/openNote';
import { registerOpenNotesFolderCommand } from './commands/openNotesFolder';
import { registerInsertImageIntoNoteCommand } from './commands/insertImageIntoNote';
import { registerRenameNoteCommand } from './commands/renameNote';
import { registerRenameFolderCommand } from './commands/renameFolder';
import { registerRevealNoteInFolderCommand } from './commands/revealNoteInFolder';
import { registerRestoreNotesCommand } from './commands/restoreNotes';
import { registerResetSyncedWarningCommand } from './commands/resetSyncedWarning';
import { registerSetupNoteHubCommand } from './commands/setupNoteHub';
import { registerSyncNotesCommand } from './commands/syncNotes';
import { registerSyncStatusCommand } from './commands/syncStatus';
import { ensureDirectory } from './storage/localStorage';
import { NotesProvider } from './tree/notesProvider';
import { getGitHubSession } from './github/auth';
import { applyLocalSyncIgnoresMigration } from './github/repoManager';
import { closeMissingTabsUnderDirectories, closeOpenTabForFile, closeOpenTabsUnderDirectory } from './utils/editorCleanup';
import { initializeLogger, logError, logInfo } from './utils/logger';
import { ensureSyncedNoteMetadata } from './utils/noteMetadata';
import { resolveLocalNotesPath, resolveSyncedNotesBasePath, resolveSyncedNotesPath } from './utils/paths';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initializeLogger();

  try {
    await Promise.all([ensureDirectory(resolveSyncedNotesPath()), ensureDirectory(resolveLocalNotesPath())]);
    await applyLocalSyncIgnoresMigration(resolveSyncedNotesBasePath());

    const notesProvider = new NotesProvider();
    const notesTreeView = vscode.window.createTreeView('devnotes.sidebar', { treeDataProvider: notesProvider });
    context.subscriptions.push(notesTreeView);
    context.subscriptions.push(
      notesTreeView.onDidChangeSelection((event) => {
        notesProvider.setSelectedItem(event.selection[0]);
      })
    );

    const syncedWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(resolveSyncedNotesBasePath(), '**/*')
    );
    const localWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(resolveLocalNotesPath(), '**/*')
    );

    const refreshNotesTree = (): void => {
      notesProvider.refresh();
    };

    const reconcileManagedNoteTabs = async (): Promise<void> => {
      await closeMissingTabsUnderDirectories([resolveSyncedNotesBasePath(), resolveLocalNotesPath()]);
      refreshNotesTree();
    };

    const handleExternalDelete = async (uri: vscode.Uri): Promise<void> => {
      try {
        const deletedPath = uri.fsPath;
        const extension = path.extname(deletedPath).toLowerCase();
        if (extension === '.md') {
          await closeOpenTabForFile(deletedPath);
        } else {
          await closeOpenTabsUnderDirectory(deletedPath);
        }
      } finally {
        refreshNotesTree();
      }
    };

    for (const watcher of [syncedWatcher, localWatcher]) {
      context.subscriptions.push(watcher);
      context.subscriptions.push(watcher.onDidCreate(reconcileManagedNoteTabs));
      context.subscriptions.push(watcher.onDidChange(reconcileManagedNoteTabs));
      context.subscriptions.push(watcher.onDidDelete(handleExternalDelete));
    }

    const treeRefreshIntervalMs = 5_000;
    const refreshTimer = setInterval(() => {
      notesProvider.refresh();
    }, treeRefreshIntervalMs);
    context.subscriptions.push(
      new vscode.Disposable(() => {
        clearInterval(refreshTimer);
      })
    );

    registerCreateNoteCommand(context, notesProvider);
    registerCreateFolderCommand(context, notesProvider);
    registerCreateNoteQuickCommand(context, notesProvider);
    registerCreateFolderQuickCommand(context, notesProvider);
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createSyncedNote', async () => {
        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === 'synced'
            ? { space: 'synced', fullPath: selectedFolder.fullPath }
            : 'synced';
        await vscode.commands.executeCommand('devnotes.createNote', targetArg);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createLocalNote', async () => {
        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === 'local'
            ? { space: 'local', fullPath: selectedFolder.fullPath }
            : 'local';
        await vscode.commands.executeCommand('devnotes.createNote', targetArg);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createSyncedFolder', async () => {
        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === 'synced'
            ? { space: 'synced', fullPath: selectedFolder.fullPath }
            : 'synced';
        await vscode.commands.executeCommand('devnotes.createFolder', targetArg);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createLocalFolder', async () => {
        const selectedFolder = notesProvider.getSelectedFolder();
        const targetArg =
          selectedFolder && selectedFolder.space === 'local'
            ? { space: 'local', fullPath: selectedFolder.fullPath }
            : 'local';
        await vscode.commands.executeCommand('devnotes.createFolder', targetArg);
      })
    );
    registerConnectGitHubCommand(context);
    registerConnectGoogleDriveCommand(context);
    registerConnectAccountCommand(context, notesProvider);
    registerSwitchAccountCommand(context, notesProvider);
    registerDisconnectAccountCommand(context, notesProvider);
    registerAccountMenuCommand(context);
    registerContinueLocalOnlyCommand(context, notesProvider);
    registerSetupNoteHubCommand(context);
    registerOpenNoteCommand(context);
    registerRenameNoteCommand(context, notesProvider);
    registerDeleteNoteCommand(context, notesProvider);
    registerDeleteFolderCommand(context, notesProvider);
    registerDuplicateNoteCommand(context, notesProvider);
    registerMoveNoteSpaceCommands(context, notesProvider);
    registerMoveNoteToFolderCommand(context, notesProvider);
    registerMoveFolderCommand(context, notesProvider);
    registerNoteActionsCommand(context);
    registerRenameFolderCommand(context, notesProvider);
    registerRevealNoteInFolderCommand(context);
    registerCopyNotePathCommand(context);
    registerOpenNotesFolderCommand(context);
    registerInsertImageIntoNoteCommand(context);
    registerSyncNotesCommand(context);
    registerSyncStatusCommand(context);
    registerRestoreNotesCommand(context);
    registerResetSyncedWarningCommand(context);

    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.refreshNotes', () => {
        notesProvider.refresh();
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const syncOnSave = vscode.workspace.getConfiguration().get<boolean>('devnotes.syncOnSave', true);
        const autoSync = vscode.workspace.getConfiguration().get<boolean>('devnotes.autoSync', true);
        const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
        const syncedNotesPath = path.resolve(resolveSyncedNotesPath());
        const savedFilePath = path.resolve(doc.fileName);
        const relativeToSynced = path.relative(syncedNotesPath, savedFilePath);
        const isInsideSyncedDirectory =
          relativeToSynced.length > 0 &&
          !relativeToSynced.startsWith('..') &&
          !path.isAbsolute(relativeToSynced);

        if (
          !syncOnSave ||
          !autoSync ||
          localOnlyMode ||
          path.extname(doc.fileName) !== '.md' ||
          !isInsideSyncedDirectory
        ) {
          return;
        }

        await ensureSyncedNoteMetadata(doc.fileName, {
          source: 'vscode',
          forceUpdatedAt: true
        });
        await vscode.commands.executeCommand('devnotes.syncNotes');
      })
    );

    // Retry sync silently when app regains focus (useful after internet comes back).
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState(async (state) => {
        if (!state.focused) {
          return;
        }

        const syncOnStartup = vscode.workspace.getConfiguration().get<boolean>('devnotes.syncOnStartup', true);
        const autoSync = vscode.workspace.getConfiguration().get<boolean>('devnotes.autoSync', true);
        const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
        if (syncOnStartup && autoSync && !localOnlyMode) {
          await vscode.commands.executeCommand('devnotes.syncNotes', { silent: true });
        }
      })
    );

    // Periodic silent sync catches pending synced changes after temporary offline periods.
    const backgroundSyncIntervalMs = 60_000;
    const timer = setInterval(async () => {
      const syncOnStartup = vscode.workspace.getConfiguration().get<boolean>('devnotes.syncOnStartup', true);
      const autoSync = vscode.workspace.getConfiguration().get<boolean>('devnotes.autoSync', true);
      const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
      if (syncOnStartup && autoSync && !localOnlyMode) {
        await vscode.commands.executeCommand('devnotes.syncNotes', { silent: true });
      }
    }, backgroundSyncIntervalMs);

    context.subscriptions.push(
      new vscode.Disposable(() => {
        clearInterval(timer);
      })
    );

    const syncOnStartup = vscode.workspace.getConfiguration().get<boolean>('devnotes.syncOnStartup', true);
    const autoSync = vscode.workspace.getConfiguration().get<boolean>('devnotes.autoSync', true);
    const localOnlyMode = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);

    const session = localOnlyMode ? undefined : await getGitHubSession(false);
    if (localOnlyMode || !session) {
      await closeOpenTabsUnderDirectory(resolveSyncedNotesPath());
    }

    if (syncOnStartup && autoSync && !localOnlyMode) {
      void vscode.commands.executeCommand('devnotes.syncNotes', { silent: true });
    }

    logInfo('QuickNotes activated successfully');
  } catch (error) {
    logError('Failed to activate QuickNotes', error);
    vscode.window.showErrorMessage('QuickNotes failed to initialize. Check Output > QuickNotes.');
  }
}

export function deactivate(): void {
  // No-op for now.
}
