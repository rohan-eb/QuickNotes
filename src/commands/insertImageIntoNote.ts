import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';
import { resolveLocalNotesPath, resolveSyncedNotesPath } from '../utils/paths';
import { maybeAutoSyncForPath } from '../utils/syncTrigger';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isNoteInsideQuickNotes(fullPath: string): boolean {
  return isInsideDirectory(fullPath, resolveSyncedNotesPath()) || isInsideDirectory(fullPath, resolveLocalNotesPath());
}

function toMarkdownPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function getUniqueTargetPath(basePath: string): Promise<string> {
  const parsed = path.parse(basePath);
  let candidate = basePath;
  let index = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function resolveTargetEditor(item?: NoteItem): Promise<vscode.TextEditor | undefined> {
  if (!item) {
    return vscode.window.activeTextEditor;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
  return vscode.window.showTextDocument(doc, { preview: false });
}

export function registerInsertImageIntoNoteCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.insertImageIntoNote', async (item?: NoteItem) => {
      try {
        const editor = await resolveTargetEditor(item);
        if (!editor) {
          vscode.window.showWarningMessage('Open a QuickNotes note first to insert an image.');
          return;
        }

        const notePath = editor.document.uri.fsPath;
        if (path.extname(notePath).toLowerCase() !== '.md' || !isNoteInsideQuickNotes(notePath)) {
          vscode.window.showWarningMessage('Insert Image works only in QuickNotes markdown notes.');
          return;
        }

        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Insert Image',
          filters: {
            Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
          }
        });
        if (!picked || picked.length === 0) {
          return;
        }

        const sourcePath = picked[0].fsPath;
        const sourceExt = path.extname(sourcePath).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(sourceExt)) {
          vscode.window.showWarningMessage('Please choose a valid image file.');
          return;
        }

        const noteDir = path.dirname(notePath);
        const assetsDir = path.join(noteDir, 'assets');
        await fs.mkdir(assetsDir, { recursive: true });

        const proposedTarget = path.join(assetsDir, path.basename(sourcePath));
        const targetPath = await getUniqueTargetPath(proposedTarget);
        await fs.copyFile(sourcePath, targetPath);

        const relativePath = toMarkdownPath(path.relative(noteDir, targetPath));
        const altText = path.parse(targetPath).name;
        const markdownImage = `![${altText}](${relativePath})`;

        await editor.edit((editBuilder) => {
          const selection = editor.selection;
          editBuilder.replace(selection, markdownImage);
        });

        await maybeAutoSyncForPath(targetPath);
      } catch (error) {
        logError('Failed to insert image into note', error);
        vscode.window.showErrorMessage('Unable to insert image into note.');
      }
    })
  );
}
