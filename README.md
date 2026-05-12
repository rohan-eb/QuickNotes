# Quick Notes (QuickNotes)

Quick Notes is a local-first VS Code notes extension with Markdown notes, private local notebooks, and optional GitHub sync.

![QuickNotes Demo](https://raw.githubusercontent.com/rohan-eb/QuickNotes/main/resources/QuickNote.gif)

## Features

- Notes sidebar in Activity Bar (`NOTEHUB: NOTES`)
- Two note spaces:
  - `Synced Notes` (GitHub-backed)
  - `Local Notes` (device-only)
- Compact note actions (`...`) with:
  - Open
  - Rename
  - Delete
  - Duplicate
  - Reveal in Folder
  - Move to Synced / Move to Local
- Account menu in top bar:
  - Switch Account
  - Disconnect Account
- Conflict-safe sync behavior with backup handling
- Auto-sync support with local-first safety

---

## Screenshots

### Sidebar Overview

![QuickNotes Sidebar](https://raw.githubusercontent.com/rohan-eb/QuickNotes/main/resources/Notes.png)

---

## Getting Started

1. Install QuickNotes.
2. Open the **QuickNotes** icon from VS Code Activity Bar.
3. Choose one of:
   - `Connect Account` (GitHub sync)
   - `Continue Local Only`
4. Create notes using the `+` icon.
5. Use `...` next to each note for actions.

### First Sync Setup

- Connect GitHub account from QuickNotes account menu.
- Create notes under `Synced Notes`.
- QuickNotes syncs to your configured **private GitHub repository**.
- If the repository does not exist yet, QuickNotes can create it (based on your settings).

### Customize Repository Name (Optional)

After installing QuickNotes, you can change the default sync repository name:

1. Open VS Code Settings (`Ctrl+,`)
2. Search for `devnotes.repoName`
3. Set your preferred repository name (default is `devnotes-sync`)
4. Run `Quick Notes: Sync Notes`

What happens if you change `devnotes.repoName` after already syncing notes:

- QuickNotes starts using the new repository name as the active sync target.
- Existing old repository is not deleted.
- Old files remain in the old repository (you can still access them on GitHub).
- Current local synced notes are pushed to the newly selected repository during sync.
- If you set the repo name back to the previous one later, QuickNotes will use that repository again.

---

## Commands (User-facing)

- `Quick Notes: Create Note`
- `Quick Notes: Connect Account`
- `Quick Notes: Switch Account`
- `Quick Notes: Disconnect Account`
- `Quick Notes: Continue Local Only`
- `Quick Notes: Open Notes Folder`
- `Quick Notes: Sync Notes`
- `Quick Notes: Sync Status`
- `Quick Notes: Restore Notes`

---

## Extension Settings

Common settings:

- `devnotes.autoSync` (default: `true`)
- `devnotes.syncOnStartup` (default: `true`)
- `devnotes.syncOnSave` (default: `true`)
- `devnotes.defaultNoteSpace` (`local` or `synced`, default: `local`)
- `devnotes.syncedNotesPath` (default: `~/.devnotes`)
- `devnotes.localNotesPath` (default: `~/.devnotes-local`)
- `devnotes.localOnlyMode` (default: `false`)
- `devnotes.repoName` (default: `devnotes-sync`)
- `devnotes.repoOwner` (optional)
- `devnotes.branch` (default: `main`)
- `devnotes.autoCreateRepo` (default: `true`)

---

## Privacy and Sync Behavior

- `Local Notes` are not pushed to remote.
- `Synced Notes` may be visible to anyone with access to the connected account/repository.
- First move to `Synced Notes` shows a privacy confirmation.

---

## Current Scope

Currently supported:

- GitHub provider flow


---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

MIT. See [LICENSE](LICENSE).
