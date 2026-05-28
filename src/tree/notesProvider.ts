import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { getCurrentSyncHealthStatus } from '../commands/syncNotes';
import { ensureDirectory } from '../storage/localStorage';
import { isConflictBackupNoteName } from '../utils/conflictBackups';
import { readNoteMetadata } from '../utils/noteMetadata';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { AccountItem, FolderItem, NoteItem, NoteSpace, PinnedGroupItem, SectionItem, SidebarItem, SpacerItem } from './noteItem';

const ARCHIVE_DIRECTORY_NAME = '.quicknotes-archive';

export class NotesProvider implements vscode.TreeDataProvider<SidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private selectedFolder?: FolderItem;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  setSelectedItem(item?: SidebarItem): void {
    if (item instanceof FolderItem) {
      this.selectedFolder = item;
      return;
    }
    this.selectedFolder = undefined;
  }

  getSelectedFolder(): FolderItem | undefined {
    return this.selectedFolder;
  }

  private isSyncedSpaceAvailable(): boolean {
    const config = vscode.workspace.getConfiguration();
    const localOnly = config.get<boolean>('devnotes.localOnlyMode', false);
    const activeAccountKey = config.get<string>('devnotes.activeAccountKey', '').trim();
    const provider = config.get<string>('devnotes.syncProvider', 'github').trim();
    const driveToken = config.get<string>('devnotes.googleDriveAccessToken', '').trim();
    if (provider === 'googleDrive') {
      return !localOnly && driveToken.length > 0 && activeAccountKey.length > 0;
    }
    return !localOnly && activeAccountKey.length > 0;
  }

  async getChildren(element?: SidebarItem): Promise<SidebarItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof SectionItem) {
      return this.getSectionChildren(element.space);
    }
    if (element instanceof PinnedGroupItem) {
      return this.getPinnedItemsForSpace(element.space);
    }
    if (element instanceof FolderItem) {
      return this.getItemsForDirectory(element.space, element.fullPath);
    }

    return [];
  }

  private async getRootItems(): Promise<SidebarItem[]> {
    const localOnly = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
    const config = vscode.workspace.getConfiguration();
    const activeAccountKey = config.get<string>('devnotes.activeAccountKey', '').trim();
    const activeAccountLabel = config.get<string>('devnotes.activeAccountLabel', '').trim();
    const provider = config.get<string>('devnotes.syncProvider', 'github').trim();
    const driveToken = config.get<string>('devnotes.googleDriveAccessToken', '').trim();
    const syncedSpaceAvailable = this.isSyncedSpaceAvailable();
    const [session, syncedNotes, localNotes] = await Promise.all([
      localOnly ? Promise.resolve(undefined) : getGitHubSession(false),
      syncedSpaceAvailable ? this.getNoteItemsForSpace('synced') : Promise.resolve([]),
      this.getNoteItemsForSpace('local')
    ]);
    const syncConnected = provider === 'googleDrive'
      ? driveToken.length > 0 && !localOnly && activeAccountKey.length > 0
      : Boolean(session) && !localOnly && activeAccountKey.length > 0;
    const emptyState = (!syncedSpaceAvailable || syncedNotes.length === 0) && localNotes.length === 0;

    await Promise.all([
      vscode.commands.executeCommand('setContext', 'devnotes.emptyState', emptyState),
      vscode.commands.executeCommand('setContext', 'devnotes.syncConnected', syncConnected)
    ]);

    if (emptyState && !syncConnected) {
      return [];
    }

    const accountLabel = provider === 'googleDrive'
      ? (syncConnected ? 'Google Drive: Connected' : localOnly ? 'Local-only mode' : 'Google Drive: Not connected')
      : session
        ? `GitHub: ${session.account.label}`
        : syncedSpaceAvailable && activeAccountLabel
          ? `GitHub: ${activeAccountLabel}`
          : localOnly
            ? 'Local-only mode'
            : 'Not connected';

    const accountDescription = syncedSpaceAvailable ? getCurrentSyncHealthStatus().state : 'Offline';

    const items: SidebarItem[] = [new AccountItem(accountLabel, accountDescription), new SpacerItem()];
    if (syncedSpaceAvailable) {
      items.push(new SectionItem('synced', 'Synced Notes'));
      items.push(new SpacerItem());
    }
    items.push(new SectionItem('local', 'Local Notes'));
    return items;
  }

  private async getSectionChildren(space: NoteSpace): Promise<SidebarItem[]> {
    if (space === 'synced' && !this.isSyncedSpaceAvailable()) {
      return [];
    }
    const pinnedItems = await this.getPinnedItemsForSpace(space);
    const regularItems = await this.getNoteItemsForSpace(space);
    return pinnedItems.length > 0 ? [new PinnedGroupItem(space), ...regularItems] : regularItems;
  }

  private async getNoteItemsForSpace(space: NoteSpace): Promise<SidebarItem[]> {
    const notesPath = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
    return this.getItemsForDirectory(space, notesPath);
  }

  private async getItemsForDirectory(space: NoteSpace, dirPath: string): Promise<SidebarItem[]> {
    await ensureDirectory(dirPath);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const folders: FolderItem[] = [];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name === '.git' ||
        entry.name === 'assets' ||
        entry.name === 'accounts' ||
        entry.name === ARCHIVE_DIRECTORY_NAME
      ) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      folders.push(new FolderItem(entry.name, fullPath, space));
    }
    folders.sort((a, b) => a.label.localeCompare(b.label));

    const notes = entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md') && !isConflictBackupNoteName(entry.name)
      )
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const { label, pinned, description } = await this.readNotePresentation(fullPath, entry.name);
        return new NoteItem(label, entry.name, fullPath, space, pinned, description);
      });

    const resolvedNotes = (await Promise.all(notes)).filter((item) => !item.pinned);
    resolvedNotes.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return a.label.toString().localeCompare(b.label.toString());
    });

    return [...folders, ...resolvedNotes];
  }

  private formatDescription(prefix?: string): string | undefined {
    return prefix || undefined;
  }

  private async getPinnedItemsForSpace(space: NoteSpace): Promise<NoteItem[]> {
    const rootPath = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
    const results: NoteItem[] = [];

    const visit = async (dirPath: string): Promise<void> => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'assets' || entry.name === 'accounts') {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ARCHIVE_DIRECTORY_NAME) {
            continue;
          }
          await visit(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.md') || isConflictBackupNoteName(entry.name)) {
          continue;
        }

        const presentation = await this.readNotePresentation(fullPath, entry.name);
        if (!presentation.pinned) {
          continue;
        }

        const relativeDir = path.relative(rootPath, path.dirname(fullPath)).replace(/\\/g, '/');
        const location = relativeDir && relativeDir !== '' ? relativeDir : undefined;
        const description = this.formatDescription(location);
        results.push(
          new NoteItem(
            presentation.label,
            entry.name,
            fullPath,
            space,
            true,
            description
          )
        );
      }
    };

    await ensureDirectory(rootPath);
    await visit(rootPath);

    results.sort((a, b) => a.label.toString().localeCompare(b.label.toString()));
    return results;
  }

  private async readNotePresentation(fullPath: string, fileName: string): Promise<{ label: string; pinned: boolean; description?: string }> {
    const baseLabel = fileName.replace(/\.md$/i, '');
    try {
      const metadata = await readNoteMetadata(fullPath);
      return {
        label: baseLabel,
        pinned: Boolean(metadata.pinned),
        description: undefined
      };
    } catch {
      // Fall back to the file name when the file cannot be read.
    }

    return { label: baseLabel, pinned: false };
  }
}
