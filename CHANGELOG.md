# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.0.4] - 2026-05-15

### Added

- Nested folder support for both `Synced Notes` and `Local Notes`.
- Top bar quick create actions for notes and folders.
- Folder context actions:
  - create note
  - create folder
  - rename folder
  - move folder
  - delete folder
- File context menu actions for notes, replacing the old compact `...` flow.
- Cross-space move support for notes and folders between `Local Notes` and `Synced Notes`.
- Image insertion support for Markdown notes with note-adjacent `assets/` storage.

### Improved

- Sync now handles nested note paths more reliably before pull/rebase.
- Sync normalizes note image locations and alt text more safely.
- Sidebar hides internal storage folders such as `assets` and `accounts`.
- Top create actions and section create actions now respect selected folder context.
- Documentation updated to match current folder, image, and move workflows.

## [0.0.3] - 2026-05-13

### Added

- Clear note separation:
  - `Synced Notes` (GitHub-backed)
  - `Local Notes` (device-only)
- Account menu in the QuickNotes header for:
  - `Switch Account`
  - `Disconnect Account`
- Compact `...` note actions menu with common actions (Open, Rename, Delete, Duplicate, Reveal in Folder, Move).
- Native empty-state welcome actions for:
  - `Add Account`
  - `Add Synced Note`
  - `Add Local Note`

### Improved

- Better sidebar UX with compact top actions (`Create`, `Refresh`, `Account`).
- Cleaner empty-state onboarding with separate synced/local actions.
- Simpler sidebar spacing and section layout for synced/local notes.
- Cleaner command palette by hiding legacy/internal commands.
- Safer sync behavior:
  - one-time privacy warning before first move to synced space
  - account-scoped synced storage so notes from one account do not appear in another account
  - local-only mode now clears remembered account scope
  - synced actions now require a valid connected account before moving or creating synced notes
  - canceling account connect keeps local notes unchanged
  - better handling when internet is unavailable, with clearer sync messages
  - automatic background sync retries when connection returns
- More reliable create/rename/delete/move sync flow for synced notes.

## [0.0.1] - 2026-05-08

### Added

- First QuickNotes release for VS Code.
- Markdown note management inside VS Code:
  - create
  - open
  - rename
  - delete
  - duplicate
- GitHub-based sync and restore support.
- Sync status support and conflict-safe backup behavior.
