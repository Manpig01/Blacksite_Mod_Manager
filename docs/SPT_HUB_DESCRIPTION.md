# Blacksite Mod Manager (v2.0.0)

Welcome to **Blacksite Mod Manager**, a fast, clean, and modern desktop client built specifically for **Single Player Tarkov (SPT)** and **Fika**. Blacksite hooks directly into **The Forge API** so you can find, install, update, and manage your entire mod library with a single click.

Whether you're grabbing a quick recoil tweak, setting up an overhaul pack, or coordinating a Fika co-op session, Blacksite handles all the heavy lifting in the background with zero lag, instant smart routing, and seamless server orchestration.

---

## ✨ Key Features

- **Clean & Consolidated UI**: Features a high-contrast tactical dark layout that merges Server mods (`user/mods` / `SPT_Runtime/user/mods`) and Client plugins (`BepInEx/plugins`) into **one single mod card**. No duplicate cards cluttering your screen!
- **Direct Forge API Sync**: Browse the full **sp-mod.com** mod catalog live inside the app. Filter by category, author (`@Author`), SPT version, download count, rating, and Fika co-op compatibility with zero browser tab juggling.
- **Drag-and-Drop Smart Router**: Just drop any `.zip`, `.7z`, or `.rar` mod archive straight into the manager. The Smart Router automatically inspects the folder structure and routes server files, BepInEx client plugins, and patchers to their exact locations.
- **Auto-Links to The Forge**: Manually dropped mods (and mods installed prior to using Blacksite) automatically match against The Forge API database, making them updateable right inside the client.
- **Fast, Non-Blocking Decompression**: Powered by native Windows multi-threaded extraction engines. Decompresses large multi-gigabyte mods with live percentage progress and zero window freezes or UI stalls.
- **1-Click Batch Mod Updater**: Automatically discovers updates across all installed mods and upgrades them in a single queued run with automatic `.json` and `.cfg` config preservation.
- **Real-Time Conflict Detection**: Instantly alerts you to duplicate client DLLs, server package ID collisions, and overlapping file paths with one-click resolution actions.
- **Integrated Server Orchestrator**: Starts your SPT local server, monitors console output in real-time, and automatically chains game client startup when the server is ready. Includes double-launch protection and server shutdown guards.
- **In-App Mod Config Editor**: Live syntax-highlighted editor for `.json`, `.jsonc`, `.cfg`, and `.yaml` config files with automatic backup rotation and JSON syntax validation before saving.
- **Deep Disk Uninstall & Purge**: Cleanly uninstalls mods and BepInEx standalone DLLs without leaving orphan files, backed by strict protection for core SPT system files.
- **Profile Management**: Switch between distinct mod profiles (e.g. Vanilla+, Hardcore Realism, Fika Co-op) with one click.
- **Custom Application Branding**: Customize your manager emblem with drag-and-drop image upload that persists offline and updates your Windows taskbar icon live.

---

## 📦 Download & Installation Options

Blacksite Mod Manager is available for **Windows 10 & 11 (64-bit)** with three convenient download formats:

| Package | File | Description |
| :--- | :--- | :--- |
| **Windows Setup Installer** *(Recommended)* | `Blacksite-Mod-Manager-Setup-2.0.0.exe` | Standard Windows installer with desktop shortcut, Start Menu integration, and clean uninstaller. |
| **Setup Installer (ZIP)** | `Blacksite-Mod-Manager-Setup-2.0.0.zip` | Standalone ZIP archive containing solely the setup executable. Ideal for environments that restrict direct `.exe` downloads. |
| **Portable Standalone** | `Blacksite-Mod-Manager-Portable-2.0.0.exe` | Zero-install standalone binary. Run directly from any folder, USB drive, or drop right into your SPT root. |

### How to Install:
1. Download either the **Setup Installer** or the **Portable Standalone** from the releases section.
2. Run the application and click **Set SPT Directory** in the top bar.
3. Select your Single Player Tarkov root directory (the folder containing `EscapeFromTarkov.exe` and `BepInEx`).
4. Blacksite will automatically scan and catalog all your existing mods!

---

## 💻 System Requirements & Compatibility

- **OS**: Windows 10 / 11 (64-bit)
- **SPT Version**: Single Player Tarkov 3.8.x through 4.1.x (supports both legacy `user/mods` and SPT 4.x `SPT_Runtime/user/mods` folder structures)
- **Fika Co-op**: Native support for Fika Client and Fika Server headless plugins
- **Network**: Internet connection required for Forge catalog browsing and automatic updates (all installed mod management, launching, and config editing work 100% offline)

---

## ❓ Frequently Asked Questions (FAQ)

<details>
<summary><b>Will updating a mod wipe my custom configuration?</b></summary>
No. Blacksite Mod Manager automatically detects existing <code>.json</code> and <code>.cfg</code> configuration files before updating and preserves your custom settings.
</details>

<details>
<summary><b>Can I install mods that aren't on The Forge?</b></summary>
Yes! Simply drag and drop any <code>.zip</code>, <code>.7z</code>, or <code>.rar</code> file into the app, and the Smart Router will extract and place the files into their proper SPT directories.
</details>

<details>
<summary><b>How does Blacksite handle SPT 4.x folder structures?</b></summary>
Blacksite natively recognizes SPT 4.x and automatically routes server mods into <code>SPT_Runtime/user/mods</code> while keeping client plugins in root <code>BepInEx/plugins</code>, preventing duplicate or misplaced directories.
</details>

<details>
<summary><b>Does Blacksite work offline?</b></summary>
Yes. You can manage installed mods, toggle mods on/off, edit configurations, resolve conflicts, and launch your SPT server and client completely offline.
</details>
