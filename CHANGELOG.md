# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.0.10] - 2026-06-12

### Fixed

- Initial GitHub connect/switch flow now keeps synced notes hidden until the new account's first sync is ready, preventing stale notes from flashing in the sidebar.
- Repeated disconnect/connect account switching now waits for in-flight sync work to settle before starting the next account handoff.
- First post-connect sync no longer surfaces a false account connection failure when the account is already authenticated.
- Synced note colors now stay consistent across browser and VS Code flows after sync.
- Browser-authored synced image paths now resolve correctly in VS Code and GitHub previews.
- Synced note edit flows now preserve and reload attached images more reliably.

### Changed

- Removed incomplete synced pin behavior from the active flow to avoid misleading non-functional UI/state.
- Publish docs and release checklists now reflect the current packaging flow and generated release artifacts.

## [0.0.9] - 2026-06-01

### Fixed

- `.quicknotes-metadata.json` is now auto-ignored via local Git excludes so users do not see or manually push metadata-only file changes.
- Added activation-time migration to apply local ignore rules for existing synced account repositories automatically.

## [0.0.8] - 2026-05-29

### Fixed

- GitHub sync now auto-recovers account-scoped repos that have no local `HEAD` yet, preventing `Could not resolve HEAD to a revision` failures after connect/reconnect.
- Sync bootstrap now attaches local account-scoped repos to existing remote branches more reliably before rebase.
- Internal repo marker cleanup now safely skips unborn-`HEAD` repositories.
- Account switch no longer triggers duplicate immediate sync runs.

## [0.0.7] - 2026-05-26

### Added

- Automatic sync identity recovery for stale `.quicknotes-sync.json` metadata after GitHub account reconnect/switch.
- Canonical sync identity recovery documentation with cross-repo QA flow references.

### Improved

- Provider-aware wording and release docs updated across README and product docs to match current GitHub + Google Drive support.

## [0.0.6] - 2026-05-21

### Improved

- Continued Release-Now UX polish across VS Code and Chrome surfaces.
- Updated packaging/version metadata for the next Marketplace-ready build.

## [0.0.5] - 2026-05-19

### Improved

- Much more reliable GitHub sync for synced notes, especially around save-time rebase flow and repeated auto-sync triggers.
- Better recovery from note conflicts, including safer handling of remote-deleted notes and internal conflict backup files.
- Moving notes between Local and Synced spaces now preserves linked images more safely.
- Renaming, moving, and deleting notes or folders now closes stale editors first to avoid confusing deleted-file tabs.
- Synced note titles are now read correctly from Markdown headings in the sidebar, even when metadata comment blocks are present.
- Internal sync marker handling is less noisy, reducing false dirty-repo states during normal sync.

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
