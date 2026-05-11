# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Cleaner first-time onboarding:
  - `Connect Account`
  - `Continue Local Only`
- Clear note separation:
  - `Synced Notes` (GitHub-backed)
  - `Local Notes` (device-only)
- Account menu in the QuickNotes header for:
  - `Switch Account`
  - `Disconnect Account`
- Compact `...` note actions menu with common actions (Open, Rename, Delete, Duplicate, Reveal in Folder, Move).

### Improved

- Better sidebar UX with compact top actions (`Create`, `Refresh`, `Account`).
- Cleaner command palette by hiding legacy/internal commands.
- Safer sync behavior:
  - one-time privacy warning before first move to synced space
  - account-scoped synced storage so notes from one account do not appear in another account
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
