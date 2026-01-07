# External Sync Bridge (Obsidian Plugin)

Backup external files or folders into a vault folder so they can be tracked by Git.

## Goal and Purpose

This project aims to provide a simple, desktop-only Obsidian plugin that pulls selected files or folders from outside a vault into a designated vault path. The purpose is to make those external files part of the vault, so they can be versioned and synced via existing Git workflows.

## What it does

- Configure one or more sync tasks.
- Each task copies a file or folder from outside the vault into a target folder inside the vault.
- Designed for desktop only (requires Node.js filesystem access).

## Status

- Scaffold initialized.
- Core implementation and settings UI TBD.

## Development

```bash
npm install
npm run dev
```

Build output: `main.js`

## License

MIT
