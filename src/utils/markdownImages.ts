import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\(([^)]+)\)/g;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

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

export async function relocateLinkedImagesForMovedNote(
  originalMarkdownPath: string,
  movedMarkdownPath: string
): Promise<void> {
  const originalDir = path.dirname(originalMarkdownPath);
  const movedDir = path.dirname(movedMarkdownPath);

  if (path.resolve(originalDir) === path.resolve(movedDir)) {
    return;
  }

  const markdownContent = await fs.readFile(movedMarkdownPath, 'utf8');
  let updatedContent = markdownContent;
  let changed = false;

  for (const match of markdownContent.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const rawPath = match[1] ?? '';
    const normalizedPath = stripLinkDecorators(rawPath);
    if (!normalizedPath || isRemoteOrDataPath(normalizedPath) || path.isAbsolute(normalizedPath)) {
      continue;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      continue;
    }

    const sourceImagePath = path.resolve(originalDir, normalizedPath);
    const sourceExists = await pathExists(sourceImagePath);
    if (!sourceExists) {
      continue;
    }

    const assetsDir = path.join(movedDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    const targetImagePath = await getUniqueTargetPath(path.join(assetsDir, path.basename(sourceImagePath)));
    await fs.rename(sourceImagePath, targetImagePath);

    const nextRelativePath = toMarkdownPath(path.relative(movedDir, targetImagePath));
    const escapedRawPath = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkRegex = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedRawPath}(\\))`, 'g');
    updatedContent = updatedContent.replace(linkRegex, `$1${nextRelativePath}$2`);
    changed = true;
  }

  if (changed && updatedContent !== markdownContent) {
    await fs.writeFile(movedMarkdownPath, updatedContent, 'utf8');
  }
}

export async function repairBrokenLocalImageLinks(markdownFilePath: string): Promise<boolean> {
  const markdownContent = await fs.readFile(markdownFilePath, 'utf8');
  const noteDir = path.dirname(markdownFilePath);
  const assetsDir = path.join(noteDir, 'assets');
  const assetsDirExists = await pathExists(assetsDir);
  if (!assetsDirExists) {
    return false;
  }

  const assetEntries = await fs.readdir(assetsDir, { withFileTypes: true }).catch(() => []);
  const assetFiles = new Map(
    assetEntries
      .filter((entry) => entry.isFile())
      .map((entry) => [entry.name.toLowerCase(), entry.name])
  );

  let updatedContent = markdownContent;
  let changed = false;

  for (const match of markdownContent.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const rawPath = match[1] ?? '';
    const normalizedPath = stripLinkDecorators(rawPath);
    if (!normalizedPath || isRemoteOrDataPath(normalizedPath) || path.isAbsolute(normalizedPath)) {
      continue;
    }

    const currentAbsolutePath = path.resolve(noteDir, normalizedPath);
    if (await pathExists(currentAbsolutePath)) {
      continue;
    }

    const fileName = path.basename(normalizedPath).toLowerCase();
    const matchedAssetName = assetFiles.get(fileName);
    if (!matchedAssetName) {
      continue;
    }

    const repairedPath = toMarkdownPath(path.join('assets', matchedAssetName));
    const escapedRawPath = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkRegex = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedRawPath}(\\))`, 'g');
    updatedContent = updatedContent.replace(linkRegex, `$1${repairedPath}$2`);
    changed = true;
  }

  if (changed && updatedContent !== markdownContent) {
    await fs.writeFile(markdownFilePath, updatedContent, 'utf8');
    return true;
  }

  return false;
}
