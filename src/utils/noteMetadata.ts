import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isConflictBackupNotePath } from './conflictBackups';
import { resolveSyncedNotesPath } from './paths';

const FRONTMATTER_DELIMITER = '---';
const COMMENT_START = '<!-- quicknotes-sync';
const COMMENT_END = '-->';
const DO_NOT_DELETE_LINE = 'do-not-delete: true';
const NOTE_METADATA_MTIME_TOLERANCE_MS = 2_000;

type MetadataFieldKey = 'quicknotesId' | 'createdAt' | 'updatedAt' | 'source';

export interface SyncedNoteMetadata {
  quicknotesId: string;
  createdAt: string;
  updatedAt: string;
  source: string;
}

interface MetadataBlock {
  body: string;
  found: boolean;
  metadataLines: string[];
  metadataRaw: string;
  prefix: string;
}

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isSyncedMarkdownNote(filePath: string): boolean {
  return (
    path.extname(filePath).toLowerCase() === '.md' &&
    !isConflictBackupNotePath(filePath) &&
    isInsideDirectory(filePath, resolveSyncedNotesPath())
  );
}

function splitMetadataBlock(documentText: string): MetadataBlock {
  if (documentText.startsWith(`${COMMENT_START}\n`)) {
    const closingIndex = documentText.indexOf(`\n${COMMENT_END}`);
    if (closingIndex >= 0) {
      let bodyStartIndex = closingIndex + `\n${COMMENT_END}`.length;
      if (documentText[bodyStartIndex] === '\n') {
        bodyStartIndex += 1;
      }
      if (documentText[bodyStartIndex] === '\n') {
        bodyStartIndex += 1;
      }

      const metadataRaw = documentText.slice(COMMENT_START.length + 1, closingIndex);
      return {
        found: true,
        metadataRaw,
        metadataLines: metadataRaw.length > 0 ? metadataRaw.split('\n') : [],
        body: documentText.slice(bodyStartIndex),
        prefix: documentText.slice(0, bodyStartIndex)
      };
    }
  }

  if (documentText.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    const closingIndex = documentText.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
    if (closingIndex >= 0) {
      let bodyStartIndex = closingIndex + `\n${FRONTMATTER_DELIMITER}`.length;
      if (documentText[bodyStartIndex] === '\n') {
        bodyStartIndex += 1;
      }
      if (documentText[bodyStartIndex] === '\n') {
        bodyStartIndex += 1;
      }

      const metadataRaw = documentText.slice(FRONTMATTER_DELIMITER.length + 1, closingIndex);
      return {
        found: true,
        metadataRaw,
        metadataLines: metadataRaw.length > 0 ? metadataRaw.split('\n') : [],
        body: documentText.slice(bodyStartIndex),
        prefix: documentText.slice(0, bodyStartIndex)
      };
    }
  }

  return {
    body: documentText,
    found: false,
    metadataLines: [],
    metadataRaw: '',
    prefix: ''
  };
}

export function getSyncedNoteBodyStartLine(documentText: string): number {
  const split = splitMetadataBlock(documentText);
  if (!split.found) {
    return 0;
  }

  return split.prefix.split('\n').length - 1;
}

function readMetadataValue(metadataRaw: string, key: MetadataFieldKey): string | undefined {
  const match = metadataRaw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function upsertMetadataValue(lines: string[], key: MetadataFieldKey, value: string): string[] {
  const nextLine = `${key}: ${value}`;
  const existingIndex = lines.findIndex((line) => new RegExp(`^${key}:\\s*`).test(line));
  if (existingIndex >= 0) {
    const next = [...lines];
    next[existingIndex] = nextLine;
    return next;
  }

  return [...lines, nextLine];
}

function buildDocumentWithMetadata(documentText: string, metadata: SyncedNoteMetadata): string {
  const split = splitMetadataBlock(documentText);
  let lines = split.metadataLines.filter((line) => !/^do-not-delete:\s*/.test(line.trim()));
  lines = upsertMetadataValue(lines, 'quicknotesId', metadata.quicknotesId);
  lines = upsertMetadataValue(lines, 'createdAt', metadata.createdAt);
  lines = upsertMetadataValue(lines, 'updatedAt', metadata.updatedAt);
  lines = upsertMetadataValue(lines, 'source', metadata.source);
  lines.push(DO_NOT_DELETE_LINE);

  const body = split.body.replace(/^\n*/, '');
  return `${COMMENT_START}\n${lines.join('\n')}\n${COMMENT_END}\n\n${body}`;
}

function sanitizeTimestamp(value: string | undefined, fallback: Date): string {
  if (!value) {
    return fallback.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback.toISOString();
  }

  return parsed.toISOString();
}

async function readMetadataState(filePath: string): Promise<{
  documentText: string;
  metadata: Partial<SyncedNoteMetadata>;
  stats: Awaited<ReturnType<typeof fs.stat>>;
}> {
  const [documentText, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
  const split = splitMetadataBlock(documentText);

  return {
    documentText,
    stats,
    metadata: {
      quicknotesId: readMetadataValue(split.metadataRaw, 'quicknotesId'),
      createdAt: readMetadataValue(split.metadataRaw, 'createdAt'),
      updatedAt: readMetadataValue(split.metadataRaw, 'updatedAt'),
      source: readMetadataValue(split.metadataRaw, 'source')
    }
  };
}

function shouldRefreshUpdatedAt(existingUpdatedAt: string | undefined, stats: Awaited<ReturnType<typeof fs.stat>>): boolean {
  if (!existingUpdatedAt) {
    return true;
  }

  const parsedUpdatedAt = new Date(existingUpdatedAt);
  if (Number.isNaN(parsedUpdatedAt.getTime())) {
    return true;
  }

  return stats.mtime.getTime() - parsedUpdatedAt.getTime() > NOTE_METADATA_MTIME_TOLERANCE_MS;
}

export async function ensureSyncedNoteMetadata(
  filePath: string,
  options?: {
    regenerateIdentity?: boolean;
    source?: string;
    forceUpdatedAt?: boolean;
    preserveUpdatedAt?: boolean;
  }
): Promise<boolean> {
  if (!isSyncedMarkdownNote(filePath)) {
    return false;
  }

  const { documentText, metadata: existing, stats } = await readMetadataState(filePath);
  const now = new Date();
  const shouldUpdateTimestamp =
    options?.preserveUpdatedAt
      ? false
      : Boolean(options?.forceUpdatedAt || shouldRefreshUpdatedAt(existing.updatedAt, stats));
  const nextMetadata: SyncedNoteMetadata = {
    quicknotesId: options?.regenerateIdentity || !existing.quicknotesId ? randomUUID() : existing.quicknotesId,
    createdAt: options?.regenerateIdentity
      ? now.toISOString()
      : sanitizeTimestamp(existing.createdAt, stats.birthtime),
    updatedAt: shouldUpdateTimestamp ? now.toISOString() : sanitizeTimestamp(existing.updatedAt, stats.mtime),
    source: (options?.source || existing.source || 'vscode').trim() || 'vscode'
  };

  const nextDocument = buildDocumentWithMetadata(documentText, nextMetadata);
  if (nextDocument === documentText) {
    return false;
  }

  await fs.writeFile(filePath, nextDocument, 'utf8');
  return true;
}

export function buildInitialNoteDocument(fileName: string, options?: { includeMetadata?: boolean; source?: string }): string {
  const baseName = fileName.replace(/\.md$/i, '');
  const body = `# ${baseName}\n\n`;
  if (!options?.includeMetadata) {
    return body;
  }

  const now = new Date().toISOString();
  return buildDocumentWithMetadata(body, {
    quicknotesId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    source: options.source?.trim() || 'vscode'
  });
}

export async function ensureSyncedNotesMetadataRecursively(rootDir: string): Promise<void> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      await ensureSyncedNotesMetadataRecursively(fullPath);
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md' && !isConflictBackupNotePath(fullPath)) {
      await ensureSyncedNoteMetadata(fullPath, { preserveUpdatedAt: true });
    }
  }
}
