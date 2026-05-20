import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { ensureDirectory } from '../storage/localStorage';
import { isConflictBackupNoteName } from '../utils/conflictBackups';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { AccountItem, FolderItem, NoteItem, NoteSpace, SectionItem, SidebarItem, SpacerItem } from './noteItem';

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

  async getChildren(element?: SidebarItem): Promise<SidebarItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof SectionItem) {
      return this.getSectionChildren(element.space);
    }
    if (element instanceof FolderItem) {
      return this.getItemsForDirectory(element.space, element.fullPath);
    }

    return [];
  }

  private async getRootItems(): Promise<SidebarItem[]> {
    const localOnly = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);
    const activeAccountKey = vscode.workspace.getConfiguration().get<string>('devnotes.activeAccountKey', '').trim();
    const [session, syncedNotes, localNotes] = await Promise.all([
      localOnly ? Promise.resolve(undefined) : getGitHubSession(false),
      this.getNoteItemsForSpace('synced'),
      this.getNoteItemsForSpace('local')
    ]);
    const syncConnected = Boolean(session) && !localOnly && activeAccountKey.length > 0;
    const emptyState = syncedNotes.length === 0 && localNotes.length === 0;

    await Promise.all([
      vscode.commands.executeCommand('setContext', 'devnotes.emptyState', emptyState),
      vscode.commands.executeCommand('setContext', 'devnotes.syncConnected', syncConnected)
    ]);

    if (emptyState && !syncConnected) {
      return [];
    }

    const accountLabel = session
      ? `GitHub: ${session.account.label}`
      : localOnly
        ? 'Local-only mode'
        : 'Not connected';

    const accountDescription = session ? 'Sync enabled' : 'Sync disabled';

    const items: SidebarItem[] = [new AccountItem(accountLabel, accountDescription), new SpacerItem()];
    items.push(new SectionItem('synced', 'Synced Notes'));
    items.push(new SpacerItem());
    items.push(new SectionItem('local', 'Local Notes'));
    return items;
  }

  private async getSectionChildren(space: NoteSpace): Promise<SidebarItem[]> {
    return this.getNoteItemsForSpace(space);
  }

  private async getNoteItemsForSpace(space: NoteSpace): Promise<SidebarItem[]> {
    const notesPath = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
    return this.getItemsForDirectory(space, notesPath);
  }

  private async directoryHasVisibleItems(dirPath: string): Promise<boolean> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'assets' || entry.name === 'accounts') {
          continue;
        }

        if (await this.directoryHasVisibleItems(fullPath)) {
          return true;
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.md') && !isConflictBackupNoteName(entry.name)) {
        return true;
      }
    }

    return false;
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
        entry.name === 'accounts'
      ) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      if (await this.directoryHasVisibleItems(fullPath)) {
        folders.push(new FolderItem(entry.name, fullPath, space));
      }
    }
    folders.sort((a, b) => a.label.localeCompare(b.label));

    const notes = entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md') && !isConflictBackupNoteName(entry.name)
      )
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const label = await this.readNoteLabel(fullPath, entry.name);
        return new NoteItem(label, entry.name, fullPath, space);
      });

    const resolvedNotes = await Promise.all(notes);
    resolvedNotes.sort((a, b) => a.label.toString().localeCompare(b.label.toString()));

    return [...folders, ...resolvedNotes];
  }

  private async readNoteLabel(fullPath: string, fileName: string): Promise<string> {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      let insideFrontmatter = false;
      let insideSyncedComment = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('<!-- quicknotes-sync')) {
          insideSyncedComment = true;
          continue;
        }
        if (insideSyncedComment) {
          if (line === '-->') {
            insideSyncedComment = false;
          }
          continue;
        }
        if (line === '---') {
          insideFrontmatter = !insideFrontmatter;
          continue;
        }
        if (!line || insideFrontmatter) {
          continue;
        }
        if (line.startsWith('# ')) {
          return line.replace(/^#\s+/, '').trim() || fileName;
        }
        break;
      }
    } catch {
      // Fall back to the file name when the file cannot be read.
    }

    return fileName;
  }
}
