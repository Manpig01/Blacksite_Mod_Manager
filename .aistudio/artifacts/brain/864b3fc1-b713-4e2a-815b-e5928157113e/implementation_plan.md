# Frameless Window Controls, Folder Explorer Integration, Disablable Recommendations, and Mod Routing

Address all 4 items requested by the user:
1. **Remove Duplicate Top Bar & Activate Custom Controls**: Eliminate the native Windows OS title bar (`frame: false`), make the custom tactical title bar draggable (`-webkit-app-region: drag`), and connect minimize, maximize/restore, and close buttons to Electron window IPC.
2. **Functional Plugins & Server Folders**: Connect the **"Plugins Folder"** (`BepInEx/plugins`) and **"Server Folder"** (`user/mods`) buttons to open the actual directories in Windows File Explorer via Electron `shell.openPath` (auto-creating folders if they don't exist).
3. **Disablable "Recommended For You" Section**: Provide an immediate dismiss/hide button in the Recommended section header, a quick-toggle checkbox in the Browse Mods filter toolbar (`Show Recommended`), and a persistent toggle in the Settings tab.
4. **Mod Manager Routing**: Align mod file destination paths with configured SPT paths (`user/mods` and `BepInEx/plugins` instead of outdated paths) and add an "Open Mod Folder" button on installed mod cards.

## User Review & Critical Decisions

> [!IMPORTANT]
> - **Frameless Window**: Electron will run with `frame: false` so Windows does not render the default white/black OS title bar on top of the custom tactical title bar.
> - **Draggable Titlebar**: `CustomTitleBar` will use `-webkit-app-region: drag`, while its buttons use `-webkit-app-region: no-drag` so the window can be moved smoothly across screens.
> - **Folder Explorer**: Clicking **Plugins Folder** or **Server Folder** will invoke Windows Explorer directly via Electron `shell.openPath(fullPath)` with fallback notifications in browser mode.

---

### 1. Overview & Core Changes

1. **Electron Main & Preload Window IPC (`electron/main.cjs` & `electron/preload.cjs`)**:
   - Set `frame: false` on `BrowserWindow`.
   - Add IPC handlers: `window:minimize`, `window:maximize`, `window:close`, `window:is-maximized`.
   - Add IPC handler `shell:open-folder` to ensure directories exist and open them in Windows File Explorer using `shell.openPath()`.
   - Expose `desktopBridge.windowControl` and `desktopBridge.openFolder` to renderer.

2. **Custom Title Bar Activation (`src/components/CustomTitleBar.tsx` & `src/App.tsx`)**:
   - Add window drag region to the header container and no-drag region to all buttons.
   - Wire minimize, maximize, and close to `window.desktopBridge.windowControl`.
   - Dynamically toggle icon between square (maximize) and restore when maximized.

3. **Plugins & Server Folder Explorer (`src/App.tsx` & `src/components/InstalledModsTab.tsx`)**:
   - `handleOpenFolder` resolves the complete SPT path (`${settings.sptDirectory}\\${settings.clientModPath}` or `serverModPath`).
   - In Electron, invokes `desktopBridge.openFolder(fullPath)`, launching native Windows Explorer.
   - Also add an "Open Folder" action button on individual installed mod cards for rapid file inspection.

4. **Disablable Recommended Section (`src/types.ts`, `BrowseModsTab.tsx`, `RecommendedModsSection.tsx`, `SettingsTab.tsx`)**:
   - Add `showRecommendedMods: boolean` to `SettingsState` (defaults to `true`).
   - Add a dismiss/hide button (`X` / "Hide") in `RecommendedModsSection`.
   - Add a `[x] Show Recommended` filter toggle checkbox in the Browse Mods filter bar.
   - Add a toggle in `SettingsTab` under General / Display Preferences so users can re-enable or disable it at any time.

5. **Mod Installation Routing Verification (`src/App.tsx`)**:
   - Ensure the installation pipeline routes server mods to `settings.serverModPath` (`user/mods`) and client mods to `settings.clientModPath` (`BepInEx/plugins`).
   - Ensure relative paths in the mod manager accurately reflect standard SPT folder architecture.

---

### 2. User Experience & Visual Design

- **Seamless Tactical Window**: The application looks like a unified, professional desktop client with no double headers. Dragging the title bar moves the window naturally; clicking minimize or maximize responds instantaneously.
- **Instant Folder Access**: Clicking "Plugins Folder" pops up Windows Explorer directly at `C:\SPT\BepInEx\plugins`.
- **Customizable Catalog**: Users who prefer a cleaner mod browser can dismiss the "Recommended For You" carousel with a single click, instantly gaining more vertical screen space for the mod grid.
