import * as path from 'node:path';

const CONFLICT_BACKUP_NOTE_PATTERN = /\.(local|remote)\.md$/i;

export function isConflictBackupNoteName(fileName: string): boolean {
  return CONFLICT_BACKUP_NOTE_PATTERN.test(fileName);
}

export function isConflictBackupNotePath(filePath: string): boolean {
  return isConflictBackupNoteName(path.basename(filePath));
}
