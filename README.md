# Blacksite Mod Manager

A modern, high-performance web mod manager for Single Player Tarkov (SPT) and Fika, ported to React, TypeScript, and Vite.

## Features

- **Catalog Browser**: Live browsing and search of sp-mod.com mods with offline/fixture fallback caching, category filtering, author search (`@Author`), SPT version filtering, and sorting options.
- **WPF Dark Theme UI**: Custom borderless dark titlebar, responsive 3-column Virtualizing mod grid, 220px cards with 135x135 thumbnails, author badges, and compatibility tags.
- **Installed Mod Manager**: Re-scan, enable/disable toggle (`.disabled` folder renaming simulation), uninstall, and automatic update checks.
- **Conflict Detector & Resolution**: Background scanner detecting duplicate client DLLs and duplicate server package IDs with resolution actions (disable mod, delete duplicate, ignore collision).
- **Installation Queue Engine**: Real-time download, 7za-first extraction staging, and SPT routing simulation with speed and progress metrics.
- **In-App Config Editor**: Syntax editor for `.json`, `.jsonc`, `.cfg`, and `.yaml` mod config files with automatic backup rotation, dirty-state guards, and validation checks.
- **Named Mod Profiles**: Create, switch, and manage mod loadouts (e.g., "Default Loadout", "Vanilla+ Minimal", "Fika Co-op Sync") with simulated atomic moves.
- **Integrated SPT Launcher**: Server process monitor with console output stream, "Server is ready" detector, and client launch chainer with double-launch guard.
- **Settings & Diagnostic Export**: SPT directory picker, auto-detected version badge, client/server routing paths (SPT 4.x `SPT_Runtime` layout support), cache cleaning, and diagnostics manifest export.

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
