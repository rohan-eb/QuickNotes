import * as vscode from 'vscode';
import { getGitHubSession } from '../github/auth';
import { runGit } from '../github/gitClient';
import { listNoteFiles } from '../storage/localStorage';
import { resolveNotesPath } from '../utils/paths';
import { logError } from '../utils/logger';

function getConfiguredRepoInfo(accountLabel: string): { owner: string; repoName: string; branch: string } {
  const config = vscode.workspace.getConfiguration();
  const owner = config.get<string>('devnotes.repoOwner', '').trim() || accountLabel;
  const repoName = config.get<string>('devnotes.repoName', 'devnotes-sync').trim();
  const branch = config.get<string>('devnotes.branch', 'main').trim();
  return { owner, repoName, branch };
}

async function readGitValue(repoPath: string, args: string[]): Promise<string> {
  try {
    const result = await runGit(repoPath, args);
    return result.stdout || 'N/A';
  } catch {
    return 'N/A';
  }
}

export function registerSyncStatusCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devnotes.syncStatus', async () => {
      try {
        const notesPath = resolveNotesPath();
        const noteFiles = await listNoteFiles();
        const session = await getGitHubSession(false);

        const accountLabel = session?.account.label ?? 'Not connected';
        const repoInfo = getConfiguredRepoInfo(session?.account.label ?? '');

        const gitRoot = await readGitValue(notesPath, ['rev-parse', '--show-toplevel']);
        const currentBranch = await readGitValue(notesPath, ['branch', '--show-current']);
        const remoteUrl = await readGitValue(notesPath, ['remote', 'get-url', 'origin']);
        const pendingChanges = await readGitValue(notesPath, ['status', '--porcelain', '--', '*.md']);

        const pendingCount = pendingChanges === 'N/A' || pendingChanges.trim() === ''
          ? 0
          : pendingChanges.split('\n').filter((line) => line.trim().length > 0).length;

        const markdown = [
          '# QuickNotes Sync Status',
          '',
          `- **GitHub Account**: ${accountLabel}`,
          `- **Configured Repo**: ${repoInfo.owner ? `${repoInfo.owner}/${repoInfo.repoName}` : repoInfo.repoName}`,
          `- **Configured Branch**: ${repoInfo.branch}`,
          `- **Notes Path**: \`${notesPath}\``,
          `- **Local Notes Count**: ${noteFiles.length}`,
          `- **Git Repo Initialized**: ${gitRoot === 'N/A' ? 'No' : 'Yes'}`,
          `- **Current Git Branch**: ${currentBranch}`,
          `- **Remote Origin**: ${remoteUrl}`,
          `- **Pending Markdown Changes**: ${pendingCount}`,
          '',
          '## Notes Files',
          noteFiles.length > 0 ? noteFiles.map((file) => `- ${file}`).join('\n') : '- No notes found'
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: markdown
        });
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
      } catch (error) {
        logError('Failed to get sync status', error);
        const reason = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unable to get sync status. ${reason}`);
      }
    })
  );
}
