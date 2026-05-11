import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  registerConnectAccountCommand,
  registerDisconnectAccountCommand,
  registerSwitchAccountCommand
} from './commands/connectAccount';
import { registerAccountMenuCommand } from './commands/accountMenu';
import { registerConnectGitHubCommand } from './commands/connectGitHub';
import { registerContinueLocalOnlyCommand } from './commands/continueLocalOnly';
import { registerCopyNotePathCommand } from './commands/copyNotePath';
import { registerCreateNoteCommand } from './commands/createNote';
import { registerCreateNoteQuickCommand } from './commands/createNoteQuick';
import { registerDeleteNoteCommand } from './commands/deleteNote';
import { registerDuplicateNoteCommand } from './commands/duplicateNote';
import { registerMoveNoteSpaceCommands } from './commands/moveNoteSpace';
import { registerNoteActionsCommand } from './commands/noteActions';
import { registerOpenNoteCommand } from './commands/openNote';
import { registerOpenNotesFolderCommand } from './commands/openNotesFolder';
import { registerRenameNoteCommand } from './commands/renameNote';
import { registerRevealNoteInFolderCommand } from './commands/revealNoteInFolder';
import { registerRestoreNotesCommand } from './commands/restoreNotes';
import { registerResetSyncedWarningCommand } from './commands/resetSyncedWarning';
import { registerSetupNoteHubCommand } from './commands/setupNoteHub';
import { registerSyncNotesCommand } from './commands/syncNotes';
import { registerSyncStatusCommand } from './commands/syncStatus';
import { ensureDirectory } from './storage/localStorage';
import { NotesProvider } from './tree/notesProvider';
import { getGitHubSession } from './github/auth';
import { closeOpenTabsUnderDirectory } from './utils/editorCleanup';
import { initializeLogger, logError, logInfo } from './utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from './utils/paths';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initializeLogger();

  try {
    await Promise.all([ensureDirectory(resolveSyncedNotesPath()), ensureDirectory(resolveLocalNotesPath())]);

    const notesProvider = new NotesProvider();
    vscode.window.registerTreeDataProvider('devnotes.sidebar', notesProvider);

    registerCreateNoteCommand(context, notesProvider);
    registerCreateNoteQuickCommand(context);
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createSyncedNote', async () => {
        await vscode.commands.executeCommand('devnotes.createNote', 'synced');
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devnotes.createLocalNote', async () => {
        await vscode.commands.executeCommand('devnotes.createNote', 'local');
      })
    );
    registerConnectGitHubCommand(context);
    registerConnectAccountCommand(context, notesProvider);
    registerSwitchAccountCommand(context, notesProvider);
    registerDisconnectAccountCommand(context, notesProvider);
    registerAccountMenuCommand(context);
    registerContinueLocalOnlyCommand(context, notesProvider);
    registerSetupNoteHubCommand(context);
    registerOpenNoteCommand(context);
    registerRenameNoteCommand(context, notesProvider);
    registerDeleteNoteCommand(context, notesProvider);
    registerDuplicateNoteCommand(context, notesProvider);
    registerNoteActionsCommand(context);
    registerMoveNoteSpaceCommands(context, notesProvider);
    registerRevealNoteInFolderCommand(context);
    registerCopyNotePathCommand(context);
    registerOpenNotesFolderCommand(context);
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
      void vscode.commands.executeCommand('devnotes.syncNotes');
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
