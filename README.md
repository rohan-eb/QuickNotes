# QuickNotes

**Keep notes where your work already lives — inside VS Code.**

QuickNotes is a Markdown note-taking extension built for developers who want a distraction-free, local-first workspace. Write notes in VS Code, keep them private on-device, or back them up silently to a private GitHub repository. No separate app. No context switching.

[![Version](https://img.shields.io/badge/version-0.0.4-blue)](https://github.com/rohan-eb/QuickNotes)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007acc)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Sync](https://img.shields.io/badge/sync-GitHub-black)](https://github.com/rohan-eb/QuickNotes)
[![Storage](https://img.shields.io/badge/storage-Markdown-informational)](https://www.markdownguide.org/basic-syntax/)

![QuickNotes Demo](https://raw.githubusercontent.com/rohan-eb/QuickNotes/main/resources/QuickNote.gif)

---

## Why QuickNotes

- **Local-first.** Notes live on your machine by default. Nothing leaves your device unless you explicitly choose to sync.
- **GitHub-backed sync.** Synced notes go to a private repository on your own GitHub account — not a third-party server.
- **Plain Markdown.** Notes are `.md` files. No proprietary format, no lock-in. Open them anywhere.
- **Stays inside VS Code.** No app to switch to. Your notes live in the Activity Bar alongside your code.

---

## Features

### Two note spaces

| Space | Storage | Synced |
|---|---|---|
| **Synced Notes** | `~/.devnotes` | ✅ GitHub (private repo) |
| **Local Notes** | `~/.devnotes-local` | ❌ Device only |

You can move notes between spaces at any time. QuickNotes shows a one-time privacy confirmation before any note is moved into the synced space.

### Folders

Create nested folder hierarchies in both Synced and Local spaces. Folders support the full set of actions: create, rename, move, and delete — all from the sidebar context menu.

### Images

Insert images directly into Markdown notes via the context menu. Images are stored in a note-adjacent `assets/` folder and are included in GitHub sync automatically.

### Sync

- Auto-syncs on save, on startup, and in the background.
- Conflict-safe: if a sync conflict arises, QuickNotes creates a backup before resolving.
- Retries automatically when connectivity is restored after going offline.
- Syncs to a **private** GitHub repository that you own. QuickNotes can create the repository for you if it does not exist.

### Sidebar overview

![QuickNotes Sidebar](https://raw.githubusercontent.com/rohan-eb/QuickNotes/main/resources/Notes.png)

---

## Getting Started

### 1. Install QuickNotes

Install from the VS Code Marketplace, then open the **QuickNotes** icon in the Activity Bar.

### 2. Choose your setup

**Sync with GitHub**
- Select `Quick Notes: Connect Account` and authenticate with GitHub.
- QuickNotes will create (or connect to) a private sync repository.
- Create notes under `Synced Notes` — they sync automatically.

**Stay local**
- Select `Quick Notes: Continue Local Only`.
- Create notes under `Local Notes` — nothing leaves your device.

You can start local and enable sync later at any time.

### 3. Create notes and folders

Use the top bar icons (`New Note` / `New Folder`) or right-click any item in the sidebar for the full action menu.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `devnotes.autoSync` | `true` | Sync automatically in the background |
| `devnotes.syncOnStartup` | `true` | Sync when VS Code opens |
| `devnotes.syncOnSave` | `true` | Sync when a note is saved |
| `devnotes.defaultNoteSpace` | `local` | Default space for new notes (`local` or `synced`) |
| `devnotes.localOnlyMode` | `false` | Disable all sync features |
| `devnotes.repoName` | `devnotes-sync` | GitHub repository name for sync |
| `devnotes.repoOwner` | — | GitHub username (inferred if not set) |
| `devnotes.branch` | `main` | Branch used for sync |
| `devnotes.autoCreateRepo` | `true` | Create the sync repo if it does not exist |
| `devnotes.syncedNotesPath` | `~/.devnotes` | Local path for synced notes |
| `devnotes.localNotesPath` | `~/.devnotes-local` | Local path for local-only notes |

### Changing the sync repository name

1. Open VS Code Settings (`Ctrl+,`) and search for `devnotes.repoName`.
2. Set your preferred repository name.
3. Run `Quick Notes: Sync Notes`.

Changing the repository name does not delete the old repository. Existing notes remain in the old repository on GitHub, and current local synced notes are pushed to the new one. Switching back to the old name re-connects to it.

---

## Commands

| Command | Description |
|---|---|
| `Quick Notes: Create Note` | Create a note (prompts for space) |
| `Quick Notes: Create Folder` | Create a folder (prompts for space) |
| `Quick Notes: Create Synced Note` | Create a note in Synced Notes |
| `Quick Notes: Create Local Note` | Create a note in Local Notes |
| `Quick Notes: Create Synced Folder` | Create a folder in Synced Notes |
| `Quick Notes: Create Local Folder` | Create a folder in Local Notes |
| `Quick Notes: Connect Account` | Connect a GitHub account for sync |
| `Quick Notes: Switch Account` | Switch to a different GitHub account |
| `Quick Notes: Disconnect Account` | Disconnect the current GitHub account |
| `Quick Notes: Continue Local Only` | Use QuickNotes without sync |
| `Quick Notes: Open Notes Folder` | Open the notes directory in your file manager |
| `Quick Notes: Insert Image Into Note` | Insert an image into the active note |
| `Quick Notes: Sync Notes` | Manually trigger a sync |
| `Quick Notes: Sync Status` | View the current sync state |
| `Quick Notes: Restore Notes` | Restore notes from the remote repository |

---

## Privacy

- **Local Notes** are stored only on your device and are never pushed to any remote.
- **Synced Notes** are stored in a **private** GitHub repository on your own account. Only you (and anyone you grant access to) can see them.
- QuickNotes shows a one-time confirmation before any note is moved into the synced space.
- Notes from one GitHub account are never mixed with notes from another.

---

## FAQ

**Does QuickNotes work without a GitHub account?**
Yes. Select `Continue Local Only` during setup. All features work except sync and restore.

**What happens if I'm offline?**
Notes are always saved locally first. If sync fails due to no connectivity, QuickNotes retries automatically when the connection returns.

**Will changing my repo name delete my old notes?**
No. The old repository and its contents remain on GitHub untouched. QuickNotes simply starts syncing to the new repository name going forward.

**Are my synced notes safe if there's a conflict?**
Yes. Before resolving any sync conflict, QuickNotes creates a local backup so no data is lost.

**Can I use my existing Markdown files?**
Not directly via import yet, but the notes directories (`~/.devnotes` and `~/.devnotes-local`) are plain folders. You can copy `.md` files there manually and they will appear in the sidebar.

---

## Changelog

### 0.0.4 — 2026-05-15
- Nested folder support for both note spaces
- Top bar quick create actions for notes and folders
- Full folder context menu (create, rename, move, delete)
- File context menu replacing the old compact `...` flow
- Cross-space move support for notes and folders
- Image insertion with note-adjacent `assets/` storage and sync

### 0.0.3 — 2026-05-13
- Separate Synced Notes and Local Notes spaces
- Account menu for switching and disconnecting accounts
- One-time privacy confirmation before moving notes to synced space
- Account-scoped synced storage (notes from one account don't appear in another)
- Auto-retry sync when connectivity is restored
- Cleaner sidebar UX and empty-state onboarding

### 0.0.1 — 2026-05-08
- Initial release: Markdown note management in VS Code
- GitHub sync and restore
- Conflict-safe backup behavior

See [CHANGELOG.md](CHANGELOG.md) for the full history.

---

## License

MIT. See [LICENSE](LICENSE).