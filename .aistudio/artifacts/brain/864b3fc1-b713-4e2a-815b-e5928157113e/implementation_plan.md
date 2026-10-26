# Portable Desktop App Button & IPC Bridge Fix Plan

## Root Cause Identified from Screenshots
In Electron 34, `BrowserWindow` enables `sandbox: true` by default unless explicitly configured otherwise. Inside a sandboxed preload script, calling `require('os')` (used on line 8 of the preload script to read `cpuCount`) throws a synchronous `Error: module not found: os` **before** `contextBridge.exposeInMainWorld('desktopBridge', ...)` executes.

Because the preload script crashes on startup:
- `window.desktopBridge` is `undefined` in the portable `.exe`, causing the app to think it is running inside a web browser preview instead of the Windows desktop runtime.
- Clicking **Minimize (`-`)**, **Maximize (`[]`)**, or **Close (`X`)** triggers the web preview fallback toasts (`"Minimized to taskbar"`, `"Window maximized"`) instead of controlling the native window.
- Clicking **Plugins Folder**, **Server Folder**, or a mod's **Open Folder** icon shows the green toast notification (`"Directory Explorer"` / `"Dual Locations Opened"`) without invoking Windows File Explorer.
- Clicking **Set SPT Directory** or **Browse…** falls back to `window.prompt()`, which is unsupported in Electron and silently does nothing.
- Clicking **Rescan**, **Enable/Disable**, **Uninstall**, **Launch SPT**, or **Install** runs in simulated web mode instead of executing disk operations.

---

## Planned Fixes

### 1. Restore the Electron Preload & IPC Bridge
- Remove unguarded Node `require('os')` calls from the preload script so it never crashes under Electron's preload environment, using safe hardware concurrency detection with a guarded fallback.
- Explicitly set `sandbox: false` in the `BrowserWindow` `webPreferences` configuration so the preload bridge loads reliably across both Portable and Setup builds.

### 2. Fix Native Window Caption Controls (Minimize, Maximize/Restore, Close)
- Ensure the custom titlebar invokes the native Electron window controls directly when running in the desktop app and accurately syncs the maximize/restore icon state (`window:minimize`, `window:maximize`, `window:close`, and `window:maximized-change`).
- Suppress web-preview toast notifications (`"Minimized to taskbar"`, `"Window maximized"`) when executing real window actions.

### 3. Fix File Explorer Folder Opening & Per-Mod Folder Routing
- **Accurate Per-Mod Folder Detection**: Update installed mod card folder resolution so a mod only opens two folders (`Dual Locations`) when it genuinely has both a server mod directory and client plugin files on disk, rather than defaulting every mod to dual folders.
- **Smart File vs. Directory Handling in Electron**: Update the native `shell:open-folder` handler so that:
  - If a target path points to a `.dll` or file, it opens Windows File Explorer with the file highlighted (`shell.showItemInFolder`) rather than trying to execute the `.dll`.
  - If a subfolder or SPT layout variant (`SPT_Runtime/user/mods`, `SPT/user/mods`, or `user/mods`) does not exist yet, it automatically resolves the active SPT server/client mod directory or walks up to the nearest existing parent directory.
- **Verified Toast Feedback**: Only display the `"Opened folder in File Explorer"` toast when the native shell confirms the directory or file was opened, showing a clear warning toast if the configured SPT directory does not exist on disk.

### 4. Replace Unsupported `window.prompt()` Calls
- Update the Header profile selector (`+ New Profile...`) so selecting it opens the inline profile creator in the Profiles & Loadouts tab or creates a named profile cleanly without relying on `window.prompt()`, which Electron blocks.
- Complete the remaining Conflict Matrix subcomponent wiring and keyboard shortcut bindings so all tabs and toolbar controls operate smoothly.
