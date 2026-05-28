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
const SIDECAR_FILE_NAME = '.quicknotes-metadata.json';

type MetadataFieldKey = 'quicknotesId' | 'createdAt' | 'updatedAt' | 'source' | 'pinned';

export interface SyncedNoteMetadata {
  quicknotesId: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  pinned: boolean;
}

interface MetadataBlock {
  body: string;
  found: boolean;
  metadataLines: string[];
  metadataRaw: string;
  prefix: string;
}

type SidecarStore = Record<string, SyncedNoteMetadata>;

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function getSidecarFilePath(rootDir: string): string {
  return path.join(rootDir, SIDECAR_FILE_NAME);
}

function getSidecarKeyForFile(filePath: string): string {
  return normalizeRelativePath(path.relative(resolveSyncedNotesPath(), filePath));
}

async function readSidecarStore(rootDir: string): Promise<SidecarStore> {
  const filePath = getSidecarFilePath(rootDir);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as SidecarStore;
  } catch {
    return {};
  }
}

async function writeSidecarStore(rootDir: string, store: SidecarStore): Promise<void> {
  const filePath = getSidecarFilePath(rootDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
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

function parsePinnedValue(value: string | undefined): boolean {
  const input = (value || '').trim().toLowerCase();
  return input === 'true' || input === '1' || input === 'yes';
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

function stripMetadataFromDocument(documentText: string): string {
  const split = splitMetadataBlock(documentText);
  return split.found ? split.body.replace(/^\n*/, '') : documentText;
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
  const rootDir = resolveSyncedNotesPath();
  const sidecar = await readSidecarStore(rootDir);
  const sidecarMetadata = sidecar[getSidecarKeyForFile(filePath)] || null;

  return {
    documentText,
    stats,
    metadata: {
      quicknotesId: sidecarMetadata?.quicknotesId || readMetadataValue(split.metadataRaw, 'quicknotesId'),
      createdAt: sidecarMetadata?.createdAt || readMetadataValue(split.metadataRaw, 'createdAt'),
      updatedAt: sidecarMetadata?.updatedAt || readMetadataValue(split.metadataRaw, 'updatedAt'),
      source: sidecarMetadata?.source || readMetadataValue(split.metadataRaw, 'source'),
      pinned: typeof sidecarMetadata?.pinned === 'boolean'
        ? sidecarMetadata.pinned
        : parsePinnedValue(readMetadataValue(split.metadataRaw, 'pinned'))
    }
  };
}

export async function readNoteMetadata(filePath: string): Promise<Partial<SyncedNoteMetadata>> {
  const { metadata } = await readMetadataState(filePath);
  return metadata;
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
    source: (options?.source || existing.source || 'vscode').trim() || 'vscode',
    pinned: Boolean(existing.pinned)
  };

  const rootDir = resolveSyncedNotesPath();
  const sidecar = await readSidecarStore(rootDir);
  const sidecarKey = getSidecarKeyForFile(filePath);
  const previousSerialized = JSON.stringify(sidecar[sidecarKey] || {});
  sidecar[sidecarKey] = nextMetadata;
  const nextSerialized = JSON.stringify(sidecar[sidecarKey]);
  const strippedDocument = stripMetadataFromDocument(documentText);
  const markdownChanged = strippedDocument !== documentText;
  const metadataChanged = previousSerialized !== nextSerialized;

  if (!markdownChanged && !metadataChanged) {
    return false;
  }

  if (markdownChanged) {
    await fs.writeFile(filePath, strippedDocument, 'utf8');
  }
  if (metadataChanged) {
    await writeSidecarStore(rootDir, sidecar);
  }
  return markdownChanged || metadataChanged;
}

export async function updateNotePinned(
  filePath: string,
  pinned: boolean,
  options?: {
    source?: string;
    forceUpdatedAt?: boolean;
  }
): Promise<boolean> {
  const { documentText, metadata: existing, stats } = await readMetadataState(filePath);
  const now = new Date();
  const nextMetadata: SyncedNoteMetadata = {
    quicknotesId: existing.quicknotesId || randomUUID(),
    createdAt: sanitizeTimestamp(existing.createdAt, stats.birthtime),
    updatedAt: options?.forceUpdatedAt ? now.toISOString() : sanitizeTimestamp(existing.updatedAt, stats.mtime),
    source: (options?.source || existing.source || 'vscode').trim() || 'vscode',
    pinned
  };

  const rootDir = resolveSyncedNotesPath();
  const sidecar = await readSidecarStore(rootDir);
  const sidecarKey = getSidecarKeyForFile(filePath);
  const previousSerialized = JSON.stringify(sidecar[sidecarKey] || {});
  sidecar[sidecarKey] = nextMetadata;
  const nextSerialized = JSON.stringify(sidecar[sidecarKey]);
  const strippedDocument = stripMetadataFromDocument(documentText);
  const markdownChanged = strippedDocument !== documentText;
  const metadataChanged = previousSerialized !== nextSerialized;

  if (!markdownChanged && !metadataChanged) {
    return false;
  }
  if (markdownChanged) {
    await fs.writeFile(filePath, strippedDocument, 'utf8');
  }
  if (metadataChanged) {
    await writeSidecarStore(rootDir, sidecar);
  }
  return markdownChanged || metadataChanged;
}

export function buildInitialNoteDocument(fileName: string, options?: { includeMetadata?: boolean; source?: string }): string {
  const baseName = fileName.replace(/\.md$/i, '');
  return `# ${baseName}\n\n`;
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
