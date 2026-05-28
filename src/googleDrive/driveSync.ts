import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveSyncedNotesPath } from '../utils/paths';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const QUICKNOTES_ROOT_FOLDER = 'QuickNotes';
const LEGACY_FOLDER_NAMES = ['browser-inbox', 'vscode-sync'];
const SYNCABLE_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const DRIVE_SYNC_STATE_FILE = '.quicknotes-drive-state.json';
const MTIME_TOLERANCE_MS = 2_000;
let rootFolderPromise: Promise<string> | null = null;

interface DriveFileEntry {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

type RemoteEntry = {
  file: DriveFileEntry;
  folderId: string;
};

type DriveSyncStateEntry = {
  fileId: string;
  localMtimeMs: number;
  remoteModifiedTime: string;
};

type DriveSyncState = Record<string, DriveSyncStateEntry>;

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toCanonicalSyncPath(filePath: string): string {
  return normalizeRelativePath(filePath);
}

function isSyncableFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SYNCABLE_EXTENSIONS.has(ext);
}


function getDriveSyncStatePath(rootDir: string): string {
  return path.join(rootDir, DRIVE_SYNC_STATE_FILE);
}

async function readDriveSyncState(rootDir: string): Promise<DriveSyncState> {
  try {
    const raw = await fs.readFile(getDriveSyncStatePath(rootDir), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as DriveSyncState : {};
  } catch {
    return {};
  }
}

async function writeDriveSyncState(rootDir: string, state: DriveSyncState): Promise<void> {
  await fs.writeFile(getDriveSyncStatePath(rootDir), JSON.stringify(state, null, 2), 'utf8');
}

async function driveJson<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    let detail = 'Google Drive request failed.';
    try {
      const data = (await response.json()) as { error?: { message?: string } };
      detail = data?.error?.message || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

async function ensureFolder(accessToken: string, folderName: string, parentId?: string): Promise<string> {
  const escaped = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${escaped}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false${parentClause}`;
  const list = await driveJson<{ files?: DriveFileEntry[] }>(
    accessToken,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime asc&pageSize=10`
  );

  const existing = Array.isArray(list.files) ? list.files[0] : undefined;
  if (existing?.id) {
    return existing.id;
  }

  const created = await driveJson<DriveFileEntry>(accessToken, `${DRIVE_API_BASE}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {})
    })
  });

  if (!created.id) {
    throw new Error(`Unable to create folder ${folderName}.`);
  }
  return created.id;
}

async function listFoldersByName(accessToken: string, folderName: string, parentId?: string): Promise<DriveFileEntry[]> {
  const escaped = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${escaped}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false${parentClause}`;
  const list = await driveJson<{ files?: DriveFileEntry[] }>(
    accessToken,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime asc&pageSize=50`
  );
  return Array.isArray(list.files) ? list.files : [];
}

async function isDriveFolderEmpty(accessToken: string, folderId: string): Promise<boolean> {
  const list = await driveJson<{ files?: DriveFileEntry[] }>(
    accessToken,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id)&pageSize=1`
  );
  return !Array.isArray(list.files) || list.files.length === 0;
}

async function ensureRootFolder(accessToken: string): Promise<string> {
  if (!rootFolderPromise) {
    rootFolderPromise = (async () => {
      const roots = await listFoldersByName(accessToken, QUICKNOTES_ROOT_FOLDER);
      const rootId = roots[0]?.id || await ensureFolder(accessToken, QUICKNOTES_ROOT_FOLDER);
      for (const legacyName of LEGACY_FOLDER_NAMES) {
        const legacyFolders = await listFoldersByName(accessToken, legacyName, rootId);
        for (const legacyFolder of legacyFolders) {
          if (legacyFolder.id && (await isDriveFolderEmpty(accessToken, legacyFolder.id))) {
            await deleteDriveFile(accessToken, legacyFolder.id).catch(() => {});
          }
        }
      }
      for (const duplicate of roots.slice(1)) {
        if (duplicate.id && (await isDriveFolderEmpty(accessToken, duplicate.id))) {
          await deleteDriveFile(accessToken, duplicate.id).catch(() => {});
        }
      }
      return rootId;
    })().finally(() => {
      rootFolderPromise = null;
    });
  }
  return rootFolderPromise;
}

async function listLocalFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listLocalFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && isSyncableFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function reconcileGoogleDriveSyncState(): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  await fs.mkdir(syncedRoot, { recursive: true });
  const state = await readDriveSyncState(syncedRoot);
  const localFiles = await listLocalFiles(syncedRoot);
  const localByRelative = new Map<string, string>();

  for (const localFile of localFiles) {
    const relative = toCanonicalSyncPath(path.relative(syncedRoot, localFile));
    if (!relative) {
      continue;
    }
    localByRelative.set(relative, localFile);
  }

  const nextState: DriveSyncState = {};
  for (const [relative, entry] of Object.entries(state)) {
    const localFile = localByRelative.get(relative);
    if (!localFile) {
      continue;
    }
    const stats = await fs.stat(localFile);
    nextState[relative] = {
      ...entry,
      localMtimeMs: stats.mtimeMs
    };
  }

  await writeDriveSyncState(syncedRoot, nextState);
}

async function listDriveFiles(accessToken: string, folderId: string): Promise<DriveFileEntry[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  const response = await driveJson<{ files?: DriveFileEntry[] }>(
    accessToken,
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,appProperties)&pageSize=1000`
  );
  return Array.isArray(response.files) ? response.files : [];
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error('Unable to delete file from Google Drive.');
  }
}

async function deleteLocalFileAndEmptyParents(rootDir: string, targetPath: string): Promise<void> {
  await fs.unlink(targetPath).catch(() => {});
  let currentDir = path.dirname(targetPath);
  const resolvedRoot = path.resolve(rootDir);
  while (path.resolve(currentDir).startsWith(resolvedRoot) && path.resolve(currentDir) !== resolvedRoot) {
    const remaining = await fs.readdir(currentDir).catch(() => []);
    if (remaining.length > 0) {
      break;
    }
    await fs.rmdir(currentDir).catch(() => {});
    currentDir = path.dirname(currentDir);
  }
}

function pickMostRecentEntry(current: RemoteEntry, next: RemoteEntry): RemoteEntry {
  const currentTime = current.file.modifiedTime ? Date.parse(current.file.modifiedTime) : 0;
  const nextTime = next.file.modifiedTime ? Date.parse(next.file.modifiedTime) : 0;
  return nextTime >= currentTime ? next : current;
}

function createMultipartBody(metadata: object, fileContent: Buffer, mimeType: string): { boundary: string; body: Buffer } {
  const boundary = `quicknotes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  return { boundary, body: Buffer.concat([head, fileContent, tail]) };
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') return 'text/markdown';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

async function uploadOrUpdateDriveFile(
  accessToken: string,
  defaultFolderId: string,
  localFullPath: string,
  relativePath: string,
  existing?: RemoteEntry
): Promise<DriveFileEntry> {
  const content = await fs.readFile(localFullPath);
  const mimeType = guessMimeType(localFullPath);
  const metadata: Record<string, unknown> = {
    name: path.basename(relativePath),
    appProperties: {
      quicknotesPath: relativePath
    }
  };
  if (!existing?.file.id) {
    metadata.parents = [defaultFolderId];
  }
  const { boundary, body } = createMultipartBody(metadata, content, mimeType);
  const endpoint = existing?.file.id
    ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.file.id)}?uploadType=multipart&fields=id,modifiedTime`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`;

  return driveJson<DriveFileEntry>(accessToken, endpoint, {
    method: existing?.file.id ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
}

async function downloadDriveFile(accessToken: string, fileId: string): Promise<Buffer> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error('Unable to download file from Google Drive.');
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function syncNotesWithGoogleDrive(accessToken: string): Promise<void> {
  const syncedRoot = resolveSyncedNotesPath();
  await fs.mkdir(syncedRoot, { recursive: true });
  const rootId = await ensureRootFolder(accessToken);
  const previousState = await readDriveSyncState(syncedRoot);
  const nextState: DriveSyncState = {};

  const [localFiles, vscodeRemoteFiles] = await Promise.all([
    listLocalFiles(syncedRoot),
    listDriveFiles(accessToken, rootId)
  ]);

  const localByRelative = new Map<string, string>();
  for (const localFile of localFiles) {
    const relative = toCanonicalSyncPath(path.relative(syncedRoot, localFile));
    if (!relative) {
      continue;
    }
    localByRelative.set(relative, localFile);
  }

  const remoteByRelative = new Map<string, RemoteEntry>();
  const combinedRemoteFiles: Array<{ file: DriveFileEntry; folderId: string }> = vscodeRemoteFiles.map((file) => ({
    file,
    folderId: rootId
  }));
  for (const remoteEntry of combinedRemoteFiles) {
    const remote = remoteEntry.file;
    const relative = remote.appProperties?.quicknotesPath
      ? toCanonicalSyncPath(remote.appProperties.quicknotesPath)
      : toCanonicalSyncPath(remote.name || '');
    if (!relative) {
      continue;
    }
    const existing = remoteByRelative.get(relative);
    if (!existing) {
      remoteByRelative.set(relative, remoteEntry);
      continue;
    }
    remoteByRelative.set(relative, pickMostRecentEntry(existing, remoteEntry));
  }

  for (const [relative, localFile] of localByRelative.entries()) {
    const remote = remoteByRelative.get(relative);
    const localStat = await fs.stat(localFile);
    const localMtime = localStat.mtimeMs;
    const remoteMtime = remote?.file.modifiedTime ? Date.parse(remote.file.modifiedTime) : 0;
    const stateEntry = previousState[relative];

    if (!remote) {
      if (stateEntry?.fileId && localMtime <= stateEntry.localMtimeMs + MTIME_TOLERANCE_MS) {
        await deleteLocalFileAndEmptyParents(syncedRoot, localFile);
        continue;
      }
      const uploaded = await uploadOrUpdateDriveFile(accessToken, rootId, localFile, relative);
      nextState[relative] = {
        fileId: uploaded.id,
        localMtimeMs: localMtime,
        remoteModifiedTime: uploaded.modifiedTime || new Date(localMtime).toISOString()
      };
      continue;
    }

    if (localMtime >= remoteMtime - MTIME_TOLERANCE_MS) {
      const uploaded = await uploadOrUpdateDriveFile(accessToken, rootId, localFile, relative, remote);
      nextState[relative] = {
        fileId: uploaded.id || remote.file.id,
        localMtimeMs: localMtime,
        remoteModifiedTime: uploaded.modifiedTime || remote.file.modifiedTime || new Date(localMtime).toISOString()
      };
      continue;
    }

    const buffer = await downloadDriveFile(accessToken, remote.file.id);
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, buffer);
    const refreshedStat = await fs.stat(localFile);
    nextState[relative] = {
      fileId: remote.file.id,
      localMtimeMs: refreshedStat.mtimeMs,
      remoteModifiedTime: remote.file.modifiedTime || new Date(refreshedStat.mtimeMs).toISOString()
    };
  }

  for (const [relative, remote] of remoteByRelative.entries()) {
    if (localByRelative.has(relative)) {
      continue;
    }
    const stateEntry = previousState[relative];
    if (stateEntry?.fileId) {
      await deleteDriveFile(accessToken, remote.file.id);
      continue;
    }
    const targetPath = path.join(syncedRoot, relative);
    const buffer = await downloadDriveFile(accessToken, remote.file.id);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    const localStat = await fs.stat(targetPath);
    nextState[relative] = {
      fileId: remote.file.id,
      localMtimeMs: localStat.mtimeMs,
      remoteModifiedTime: remote.file.modifiedTime || new Date(localStat.mtimeMs).toISOString()
    };
  }

  await writeDriveSyncState(syncedRoot, nextState);
}

export async function deleteSyncedFileFromGoogleDrive(accessToken: string, relativePath: string): Promise<void> {
  const normalizedRelativePath = toCanonicalSyncPath(relativePath);
  if (!normalizedRelativePath) {
    return;
  }

  const rootId = await ensureRootFolder(accessToken);
  const vscodeFiles = await listDriveFiles(accessToken, rootId);

  const matching = vscodeFiles.filter((file) => {
    const fileRelativePath = file.appProperties?.quicknotesPath
      ? toCanonicalSyncPath(file.appProperties.quicknotesPath)
      : toCanonicalSyncPath(file.name || '');
    return fileRelativePath === normalizedRelativePath;
  });

  await Promise.all(matching.map((file) => deleteDriveFile(accessToken, file.id)));
  const syncedRoot = resolveSyncedNotesPath();
  const state = await readDriveSyncState(syncedRoot);
  delete state[normalizedRelativePath];
  await writeDriveSyncState(syncedRoot, state);
}
