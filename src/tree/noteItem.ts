import * as path from 'node:path';
import * as vscode from 'vscode';

export type NoteSpace = 'synced' | 'local';

export class NoteItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly fullPath: string,
    public readonly space: NoteSpace
  ) {
    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `noteItem.${space}`;
    this.command = {
      command: 'devnotes.openNote',
      title: 'Open Note',
      arguments: [this]
    };

    this.resourceUri = vscode.Uri.file(path.resolve(fullPath));
  }
}

export class ActionItem extends vscode.TreeItem {
  constructor(label: string, command: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'actionItem';
    this.description = description;
    this.command = { command, title: label };
  }
}

export class AccountItem extends vscode.TreeItem {
  constructor(label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'accountItem';
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('account');
  }
}

export class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly space: NoteSpace,
    label: string,
    description?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `sectionItem.${space}`;
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(space === 'synced' ? 'cloud' : 'device-desktop');
  }
}

export type SidebarItem = NoteItem | ActionItem | AccountItem | SectionItem;
