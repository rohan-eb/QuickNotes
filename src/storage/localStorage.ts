import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveSyncedNotesPath } from '../utils/paths';
import { isConflictBackupNoteName } from '../utils/conflictBackups';
import { buildInitialNoteDocument } from '../utils/noteMetadata';

export async function ensureDirectory(dirPath: string): Promise<string> {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function ensureNotesDirectory(): Promise<string> {
  return ensureDirectory(resolveSyncedNotesPath());
}

export async function listNoteFilesInDirectory(dirPath: string): Promise<string[]> {
  await ensureDirectory(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !isConflictBackupNoteName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function listNoteFiles(): Promise<string[]> {
  const notesPath = await ensureNotesDirectory();
  return listNoteFilesInDirectory(notesPath);
}

export async function createNoteFileInDirectory(
  dirPath: string,
  fileName: string,
  options?: { includeMetadata?: boolean; source?: string }
): Promise<string> {
  await ensureDirectory(dirPath);
  const sanitizedName = fileName.trim().replace(/\s+/g, '-');
  const finalName = sanitizedName.endsWith('.md') ? sanitizedName : `${sanitizedName}.md`;
  const fullPath = path.join(dirPath, finalName);

  await fs.writeFile(fullPath, buildInitialNoteDocument(finalName, options), { flag: 'wx' });
  return fullPath;
}

export async function createNoteFile(fileName: string): Promise<string> {
  return createNoteFileInDirectory(await ensureNotesDirectory(), fileName);
}

export async function renameNoteByPath(fullPath: string, newName: string): Promise<string> {
  const dirPath = path.dirname(fullPath);
  const newSanitized = newName.trim().replace(/\s+/g, '-');
  const newFileName = newSanitized.endsWith('.md') ? newSanitized : `${newSanitized}.md`;
  const newPath = path.join(dirPath, newFileName);

  await fs.rename(fullPath, newPath);
  return newPath;
}

export async function deleteNoteByPath(fullPath: string): Promise<void> {
  await fs.unlink(fullPath);
}

export async function copyNoteByPath(sourcePath: string, targetFileName: string): Promise<string> {
  const dirPath = path.dirname(sourcePath);
  const normalizedTarget = targetFileName.trim().replace(/\s+/g, '-');
  const finalTargetName = normalizedTarget.endsWith('.md') ? normalizedTarget : `${normalizedTarget}.md`;
  const targetPath = path.join(dirPath, finalTargetName);

  await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  return targetPath;
}

export async function moveNoteToDirectory(sourcePath: string, targetDirPath: string): Promise<string> {
  await ensureDirectory(targetDirPath);
  const destinationPath = path.join(targetDirPath, path.basename(sourcePath));
  await fs.rename(sourcePath, destinationPath);
  return destinationPath;
}
