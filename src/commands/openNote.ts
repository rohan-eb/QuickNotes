import * as vscode from 'vscode';
import { NoteItem } from '../tree/noteItem';
import { logError } from '../utils/logger';
import { getSyncedNoteBodyStartLine, isSyncedMarkdownNote } from '../utils/noteMetadata';

async function focusNoteBody(editor: vscode.TextEditor): Promise<void> {
  const bodyStartLine = getSyncedNoteBodyStartLine(editor.document.getText());
  const clampedLine = Math.min(bodyStartLine, Math.max(0, editor.document.lineCount - 1));
  const targetPosition = new vscode.Position(clampedLine, 0);
  const targetRange = new vscode.Range(targetPosition, targetPosition);

  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(targetRange, vscode.TextEditorRevealType.AtTop);

  if (clampedLine <= 0) {
    return;
  }

  try {
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(clampedLine - 1, 0));
    await vscode.commands.executeCommand('editor.fold');
  } catch {
    // Folding is best-effort only. The reveal logic above keeps metadata out of view.
  } finally {
    editor.selection = new vscode.Selection(targetPosition, targetPosition);
    editor.revealRange(targetRange, vscode.TextEditorRevealType.AtTop);
  }
}

export function registerOpenNoteCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.openNote', async (item: NoteItem) => {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
        const editor = await vscode.window.showTextDocument(doc);
        if (isSyncedMarkdownNote(item.fullPath)) {
          await focusNoteBody(editor);
        }
      } catch (error) {
        logError('Failed to open note', error);
        vscode.window.showErrorMessage('Unable to open note.');
      }
    })
  );
}
