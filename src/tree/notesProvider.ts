import * as path from 'node:path';
import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { listNoteFilesInDirectory } from '../storage/localStorage';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { AccountItem, ActionItem, NoteItem, NoteSpace, SectionItem, SidebarItem } from './noteItem';

export class NotesProvider implements vscode.TreeDataProvider<SidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SidebarItem): Promise<SidebarItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof SectionItem) {
      return this.getNoteItemsForSpace(element.space);
    }

    return [];
  }

  private async getRootItems(): Promise<SidebarItem[]> {
    const localOnly = vscode.workspace.getConfiguration().get<boolean>('devnotes.localOnlyMode', false);

    const [session, syncedNotes, localNotes] = await Promise.all([
      localOnly ? Promise.resolve(undefined) : getGitHubSession(false),
      this.getNoteItemsForSpace('synced'),
      this.getNoteItemsForSpace('local')
    ]);

    const noNotes = syncedNotes.length === 0 && localNotes.length === 0;
    if (!session && noNotes) {
      return [
        new ActionItem('Connect Account', 'devnotes.connectAccount', 'Enable sync'),
        new ActionItem('Continue Local Only', 'devnotes.continueLocalOnly', 'No remote sync')
      ];
    }

    const accountLabel = session
      ? `GitHub: ${session.account.label}`
      : localOnly
        ? 'Local-only mode'
        : 'Not connected';

    const accountDescription = session ? 'Sync enabled' : 'Sync disabled';

    const items: SidebarItem[] = [new AccountItem(accountLabel, accountDescription)];

    // Security/clarity: only show Synced Notes space when an account session exists.
    if (session) {
      items.push(new SectionItem('synced', 'Synced Notes'));
    }

    items.push(new SectionItem('local', 'Local Notes', 'Stored only on this machine'));
    return items;
  }

  private async getNoteItemsForSpace(space: NoteSpace): Promise<NoteItem[]> {
    const notesPath = space === 'synced' ? resolveSyncedNotesPath() : resolveLocalNotesPath();
    const files = await listNoteFilesInDirectory(notesPath);
    return files.map((file) => new NoteItem(file, path.join(notesPath, file), space));
  }
}
