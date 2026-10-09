# Blacksite: Tactical Shield Patch Icon Implementation Plan

Replace all application icons and branding elements with the user's uploaded tactical shield patch design across the entire application: the native window titlebar, top header, browser tab favicon, taskbar icon, native desktop binaries, and documentation.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Summary of Confirmed User Decisions**
> - **Exact Patch Design**: Use the uploaded octagonal tactical shield insignia featuring:
>   - Heavy bolted octagonal steel armor plate with weathered metallic edge bolts.
>   - Left & right tactical yellow-and-black hazard warning stripes (`/ / / /`).
>   - Top military stencil header: `SPT` in weathered off-white with tactical spray texture.
>   - Central industrial mechanical gear/cog with wire mesh background.
>   - Grinning tactical skull wearing a ballistic helmet and night vision goggles / dual optical lenses.
>   - Bold distressed military stencil title: `BLACKSITE` in tactical orange.
>   - Arched bottom rocker tab banner: `MOD MANAGER` with yellow/orange lettering and border.
> - **Comprehensive Application**: This emblem will be applied everywhere:
>   1. **Window Titlebar**: Top-left corner of the borderless custom titlebar (`CustomTitleBar.tsx`).
>   2. **Top Header**: Main navigation header (`Header.tsx`) replacing any prior logo.
>   3. **Browser & Tab Favicon**: High-DPI SVG favicon and PNG fallback in `index.html`.
>   4. **Windows Taskbar & Executable**: Converted multi-resolution Windows icon (`app.ico`) and high-res PNG (`emblem.png`) in `public/` and configured in `electron/main.cjs` and `package.json`.
>   5. **Windows Download Modal & README**: Updated modal preview and GitHub documentation banner.

---

## 1. Implementation Steps

### Step 1: Craft the Octagonal Tactical Shield Emblem
- Create an authentic, razor-sharp vector SVG asset (`public/emblem.svg`) reproducing every visual layer of the user's uploaded patch:
  - **Outer Frame**: Octagonal dark carbon/slate armor plate with perimeter rivets/bolts and rust distressing.
  - **Hazard Stripes**: Diagonal black and yellow hazard chevrons along both the left and right borders.
  - **Top Text**: Stencil military lettering `SPT` centered above the central gear.
  - **Industrial Gear & Mesh**: Steel 12-tooth mechanical cogwheel with an inner diamond wire mesh grill.
  - **Tactical Skull & Optics**: Skull wearing a combat helmet with Wilcox shroud and dual night vision goggle lenses.
  - **Stencil Branding**: Distressed block letters `BLACKSITE` in tactical orange (`#EA580C` / `#F59E0B`).
  - **Rocker Banner**: Curved lower black plate with border and bold `MOD MANAGER` typography.

### Step 2: Render Multi-Resolution Assets
- Use `rsvg-convert` and `convert` to produce:
  - `public/emblem.png`: 512x512 high-resolution transparent PNG.
  - `public/app.ico`: Windows multi-resolution icon resource containing 256x256, 128x128, 64x64, 48x48, 32x32, and 16x16 icon layers for the Windows taskbar and explorer.

### Step 3: Wire Up Across All UI Components
- **`src/components/CustomTitleBar.tsx`**: Update top-left image to reference `/emblem.svg` with `/emblem.png` fallback.
- **`src/components/Header.tsx`**: Display the tactical shield patch alongside the title in the header.
- **`index.html`**: Configure SVG and PNG favicon tags.
- **`electron/main.cjs`**: Verify window icon loads `path.join(__dirname, '../public/app.ico')`.
- **`src/components/WindowsDownloadModal.tsx`**: Display the shield patch icon in the standalone packaging modal.
- **`README.md`**: Ensure the shield emblem is showcased at the top of the repository overview.

---

## 2. Verification Plan

1. **Asset Generation Check**:
   - Verify `public/emblem.svg`, `public/emblem.png`, and `public/app.ico` are generated without errors.
2. **Compilation & Linting**:
   - Run `compile_applet` and `lint_applet` to confirm zero build regressions.
3. **UI Visual Inspection**:
   - Check titlebar top-left emblem.
   - Check header branding.
   - Check favicon and modals.
