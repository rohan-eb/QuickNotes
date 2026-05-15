import * as path from 'node:path';
import * as vscode from 'vscode';

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function closeOpenTabsUnderDirectory(rootDir: string): Promise<number> {
  const tabsToClose: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (isInsideDirectory(input.uri.fsPath, rootDir)) {
          tabsToClose.push(tab);
        }
      }
    }
  }

  if (tabsToClose.length === 0) {
    return 0;
  }

  await vscode.window.tabGroups.close(tabsToClose);
  return tabsToClose.length;
}

export async function closeOpenTabForFile(filePath: string): Promise<boolean> {
  const resolvedTarget = path.resolve(filePath);

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && path.resolve(input.uri.fsPath) === resolvedTarget) {
        await vscode.window.tabGroups.close(tab);
        return true;
      }
    }
  }

  return false;
}
