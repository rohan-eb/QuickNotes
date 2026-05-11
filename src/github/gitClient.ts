import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    const details = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
    };

    const stderr = details.stderr?.trim() ?? details.message ?? 'Unknown git error';
    throw new Error(stderr);
  }
}

function buildGitHubAuthHeader(token: string): string {
  const credentials = Buffer.from(`x-access-token:${token}`).toString('base64');
  return `AUTHORIZATION: basic ${credentials}`;
}

export async function runGitWithGitHubAuth(cwd: string, args: string[], token: string): Promise<GitResult> {
  const authHeader = buildGitHubAuthHeader(token);
  return runGit(cwd, ['-c', `http.https://github.com/.extraheader=${authHeader}`, ...args]);
}
