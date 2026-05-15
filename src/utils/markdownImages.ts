import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\(([^)]+)\)/g;

function stripLinkDecorators(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isRemoteOrDataPath(linkPath: string): boolean {
  const lower = linkPath.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('mailto:')
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function findBrokenImageLinks(markdownFilePath: string): Promise<string[]> {
  const markdownContent = await fs.readFile(markdownFilePath, 'utf8');
  const brokenLinks: string[] = [];
  const noteDir = path.dirname(markdownFilePath);
  const seen = new Set<string>();

  for (const match of markdownContent.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const rawPath = match[1] ?? '';
    const normalizedPath = stripLinkDecorators(rawPath);
    if (!normalizedPath || isRemoteOrDataPath(normalizedPath)) {
      continue;
    }
    if (path.isAbsolute(normalizedPath)) {
      continue;
    }

    const absoluteImagePath = path.resolve(noteDir, normalizedPath);
    const exists = await pathExists(absoluteImagePath);
    if (!exists && !seen.has(normalizedPath)) {
      seen.add(normalizedPath);
      brokenLinks.push(normalizedPath);
    }
  }

  return brokenLinks;
}
