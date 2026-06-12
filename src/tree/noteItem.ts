import * as path from 'node:path';
import * as vscode from 'vscode';

export type NoteSpace = 'synced' | 'local';

export class NoteItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly fileName: string,
    public readonly fullPath: string,
    public readonly space: NoteSpace,
    descriptionText?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.contextValue = `noteItem.${space}`;
    this.description = descriptionText;
    this.command = {
      command: 'devnotes.openNote',
      title: 'Open Note',
      arguments: [this]
    };

    this.resourceUri = vscode.Uri.file(path.resolve(fullPath));
  }
}

export class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly fullPath: string,
    public readonly space: NoteSpace
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `folderItem.${space}`;
    this.resourceUri = vscode.Uri.file(path.resolve(fullPath));
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class ActionItem extends vscode.TreeItem {
  constructor(
    label: string,
    command: string,
    description?: string,
    iconId: string = 'arrow-right'
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'actionItem';
    this.description = description;
    this.command = { command, title: label };
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

export class AccountItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
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

export class SpacerItem extends vscode.TreeItem {
  constructor() {
    super(' ', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'spacerItem';
  }
}

export type SidebarItem =
  | NoteItem
  | FolderItem
  | ActionItem
  | AccountItem
  | SectionItem
  | SpacerItem;
