# Fix Image Loading and Native Folder Selection in Windows Desktop App

Enable mod image loading from the Forge API in the packaged Windows application and implement the native Windows Folder Picker dialog when clicking "Set SPT Directory".

## User Review & Critical Decisions

> [!IMPORTANT]
> In the packaged Windows application (`file:///` protocol):
> 1. Mod images failed to load because `ModThumbnail` was requesting relative `/api/forge-image` URLs (which only exist in Vite dev/preview server) and direct Forge URLs were blocked by Cloudflare hotlink protection when `referrerPolicy="no-referrer"` was used.
> 2. The "Set SPT Directory" button was cycling through dummy mock paths instead of invoking Electron's native OS directory picker dialog (`dialog.showOpenDialog`).

- **Confirmed Decision 1**: Implement Electron IPC `dialog:select-directory` using Electron's native `dialog.showOpenDialog({ properties: ['openDirectory'] })`, exposed to the renderer via `window.desktopBridge.selectDirectory()`, with fallback to the HTML5 File System API or prompt in browser environments.
- **Confirmed Decision 2**: Enable seamless image loading in Electron by:
  - Intercepting outbound web requests to `*.sp-mod.com` in Electron's main process via `session.defaultSession.webRequest.onBeforeSendHeaders` to automatically supply `Referer: https://sp-mod.com/`.
  - Adding an Electron IPC handler `forge:fetch-image-data-url` that fetches images via Node.js native fetch and returns them as Base64 Data URLs if direct browser rendering encounters network issues.
  - Updating `ModThumbnail` to use direct HTTPS URLs and IPC fallback when running in Electron.

---

### 1. Overview & Core Concept

- **Issue 1 - Images Not Loading**: `sp-mod.com` requires a valid `Referer: https://sp-mod.com/` header. In Vite dev mode, a local proxy middleware handles this. In packaged Electron (`file://`), relative `/api/forge-image` paths fail with `ERR_FILE_NOT_FOUND`, and `<img referrerPolicy="no-referrer">` causes `sp-mod.com` to return HTTP 403 Forbidden.
- **Issue 2 - Set SPT Directory Not Prompting**: Clicking the button currently executed a test handler that cycled through 3 sample strings (`C:\Games\SPT-Tarkov`, `D:\Games\SPT-4.0`, `E:\SPT`).

---

### 2. User Experience & Visual Design

- **Native Windows Folder Dialog**: Clicking **"Set SPT Directory"** in the top navigation bar (or **"Browse…"** in Settings) immediately opens the standard Windows Explorer **"Select Folder"** dialog. Once a folder is chosen, the UI instantly updates with the full path, validates the directory structure, and saves it to local persistence.
- **Rich Mod Image Display**: Mod cards in the Browse tab display real mod preview screenshots, icons, and author avatars fetched directly from the Forge API, with tactical category artwork remaining as a graceful fallback for mods without screenshots.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Native Electron Dialog via Preload Bridge**
  - *Chosen Approach*: Expose `selectDirectory(defaultPath)` through `electron/preload.cjs` that invokes `dialog.showOpenDialog` in `electron/main.cjs`.
  - *Why*: Gives the user a 100% native Windows Explorer directory picker with drive navigation, network shares, and quick access folders.

- **Decision 2: Electron Session Request Interception & Node Fetch Fallback**
  - *Chosen Approach*:
    1. In `electron/main.cjs`, use `session.defaultSession.webRequest.onBeforeSendHeaders` to attach `Referer: https://sp-mod.com/` to all Forge requests.
    2. Add `ipcMain.handle('forge:fetch-image-data-url')` as a fail-safe fallback.
    3. In `ModThumbnail.tsx`, detect `window.desktopBridge.isElectron` to avoid relative `/api/forge-image` URLs and remove the blocking `no-referrer` policy.
  - *Why*: Completely solves Cloudflare hotlink protection in both Electron `.exe` and web browser modes.

---

### 4. Technical Architecture & File Changes

```
┌────────────────────────────────────────────────────────┐
│                      Renderer UI                       │
│    "Set SPT Directory" Button / ModThumbnail Component │
└───────────┬────────────────────────────────┬───────────┘
            │ selectDirectory()              │ forge:fetch-image-data-url()
            ▼                                ▼
┌────────────────────────────────────────────────────────┐
│                  electron/preload.cjs                  │
│     contextBridge.exposeInMainWorld('desktopBridge')   │
└───────────┬────────────────────────────────┬───────────┘
            │ ipcRenderer.invoke             │ ipcRenderer.invoke
            ▼                                ▼
┌────────────────────────────────────────────────────────┐
│                   electron/main.cjs                    │
│  - dialog.showOpenDialog({ properties: ['openDir'] }) │
│  - webRequest.onBeforeSendHeaders (Referer injection)  │
│  - Node fetch buffer -> base64 data URL handler        │
└────────────────────────────────────────────────────────┘
```

#### Affected Files:
1. `electron/main.cjs`: Add `dialog`, `session`, `ipcMain` handlers for folder selection and Forge image proxy/header injection.
2. `electron/preload.cjs`: Expose `selectDirectory()` and `fetchImageDataUrl()` on `window.desktopBridge`.
3. `src/components/ModThumbnail.tsx`: Detect desktop environment, load direct Forge image URLs, utilize IPC fallback if needed, and remove `referrerPolicy="no-referrer"`.
4. `src/App.tsx`: Connect `onPickDirectory` to `desktopBridge.selectDirectory()`, with browser folder picker / prompt fallback.
5. `src/components/SettingsTab.tsx`: Connect the "Browse…" button to the same native directory picker.
