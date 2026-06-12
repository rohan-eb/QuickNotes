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

type MetadataFieldKey = 'quicknotesId' | 'createdAt' | 'updatedAt' | 'source' | 'color';

export interface SyncedNoteMetadata {
  quicknotesId: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  color: string;
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

function sanitizeColor(value: string | undefined): string {
  const next = value?.trim();
  return next || '#ffffff';
}

function normalizeSidecarEntry(entry: Partial<SyncedNoteMetadata> & { pinned?: unknown } | null | undefined): SyncedNoteMetadata | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    quicknotesId: typeof entry.quicknotesId === 'string' ? entry.quicknotesId : '',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    source: typeof entry.source === 'string' ? entry.source : 'vscode',
    color: sanitizeColor(typeof entry.color === 'string' ? entry.color : undefined)
  };
}

function normalizeSidecarStore(store: SidecarStore): { store: SidecarStore; changed: boolean } {
  let changed = false;
  const nextStore: SidecarStore = {};

  for (const [key, value] of Object.entries(store || {})) {
    const normalized = normalizeSidecarEntry(value);
    if (!normalized) {
      changed = true;
      continue;
    }

    nextStore[key] = normalized;
    if (
      normalized.quicknotesId !== value.quicknotesId ||
      normalized.createdAt !== value.createdAt ||
      normalized.updatedAt !== value.updatedAt ||
      normalized.source !== value.source ||
      normalized.color !== value.color ||
      Object.prototype.hasOwnProperty.call(value || {}, 'pinned')
    ) {
      changed = true;
    }
  }

  return { store: nextStore, changed };
}

async function readMetadataState(filePath: string): Promise<{
  metadata: Partial<SyncedNoteMetadata>;
  stats: Awaited<ReturnType<typeof fs.stat>>;
}> {
  const [documentText, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
  const split = splitMetadataBlock(documentText);
  const rootDir = resolveSyncedNotesPath();
  const rawSidecar = await readSidecarStore(rootDir);
  const { store: sidecar, changed: sidecarChanged } = normalizeSidecarStore(rawSidecar);
  const sidecarMetadata = sidecar[getSidecarKeyForFile(filePath)] || null;
  const markdownColor = readMetadataValue(split.metadataRaw, 'color');
  let migrated = false;

  if (sidecarMetadata && !sidecarMetadata.color && markdownColor) {
    sidecar[getSidecarKeyForFile(filePath)] = {
      ...sidecarMetadata,
      color: sanitizeColor(markdownColor)
    };
    migrated = true;
  }

  if (migrated || sidecarChanged) {
    await writeSidecarStore(rootDir, sidecar);
  }

  return {
    stats,
    metadata: {
      quicknotesId: sidecarMetadata?.quicknotesId || readMetadataValue(split.metadataRaw, 'quicknotesId'),
      createdAt: sidecarMetadata?.createdAt || readMetadataValue(split.metadataRaw, 'createdAt'),
      updatedAt: sidecarMetadata?.updatedAt || readMetadataValue(split.metadataRaw, 'updatedAt'),
      source: sidecarMetadata?.source || readMetadataValue(split.metadataRaw, 'source'),
      color: sidecarMetadata?.color || markdownColor
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

  const { metadata: existing, stats } = await readMetadataState(filePath);
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
    color: sanitizeColor(existing.color)
  };

  const rootDir = resolveSyncedNotesPath();
  const sidecar = await readSidecarStore(rootDir);
  const sidecarKey = getSidecarKeyForFile(filePath);
  const previousSerialized = JSON.stringify(sidecar[sidecarKey] || {});
  sidecar[sidecarKey] = nextMetadata;
  const nextSerialized = JSON.stringify(sidecar[sidecarKey]);
  const markdownChanged = false;
  const metadataChanged = previousSerialized !== nextSerialized;

  if (!markdownChanged && !metadataChanged) {
    return false;
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
