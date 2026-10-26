import {
  ModProfile,
  InstalledMod,
  ProfileDiffResult,
  BsiteBundleManifest,
  BsiteBundleModEntry,
  BsiteImportPreflight,
  SptPlayerProfile,
} from '../types';
import { getDesktopBridge } from './desktopBridgeService';


export const profileService = {
  /**
   * Computes a side-by-side tactical diff between two mod profiles
   */
  computeProfileDiff(
    profileA: ModProfile,
    profileB: ModProfile,
    allMods: InstalledMod[]
  ): ProfileDiffResult {
    const setA = new Set(profileA.enabledModIds.map((id) => id.toLowerCase()));
    const setB = new Set(profileB.enabledModIds.map((id) => id.toLowerCase()));

    const commonMods: InstalledMod[] = [];
    const onlyInProfileA: InstalledMod[] = [];
    const onlyInProfileB: InstalledMod[] = [];

    for (const mod of allMods) {
      const idKey = mod.id.toLowerCase();
      const inA = setA.has(idKey);
      const inB = setB.has(idKey);

      if (inA && inB) {
        commonMods.push(mod);
      } else if (inA && !inB) {
        onlyInProfileA.push(mod);
      } else if (!inA && inB) {
        onlyInProfileB.push(mod);
      }
    }

    const loadOrderMismatches: ProfileDiffResult['loadOrderMismatches'] = [];
    for (const mod of commonMods) {
      const orderA = profileA.customLoadOrder?.[mod.id] ?? mod.loadOrder ?? 100;
      const orderB = profileB.customLoadOrder?.[mod.id] ?? mod.loadOrder ?? 100;
      if (orderA !== orderB) {
        loadOrderMismatches.push({
          modId: mod.id,
          modName: mod.name,
          orderA,
          orderB,
        });
      }
    }

    return {
      profileA,
      profileB,
      commonMods,
      onlyInProfileA,
      onlyInProfileB,
      versionMismatches: [],
      loadOrderMismatches,
    };
  },

  /**
   * Creates a new Tactical ModProfile instance
   */
  createProfile(
    name: string,
    description: string = '',
    options: Partial<ModProfile> = {},
    initialMods: InstalledMod[] = []
  ): ModProfile {
    const now = Date.now();
    const dateStr = new Date(now).toISOString().split('T')[0];

    const enabledModIds = options.enabledModIds ?? initialMods.filter((m) => !m.isDisabled).map((m) => m.id);

    return {
      id: `prof-${now}-${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || 'New Loadout',
      description: description.trim() || 'Custom mod profile',
      enabledModIds,
      createdDate: dateStr,
      createdAt: now,
      updatedAt: now,
      isDefault: Boolean(options.isDefault),
      customLoadOrder: options.customLoadOrder ? { ...options.customLoadOrder } : {},
      linkedSptProfileId: options.linkedSptProfileId,
      linkedSptProfileName: options.linkedSptProfileName,
      modConfigs: options.modConfigs ? { ...options.modConfigs } : {},
      tags: options.tags && options.tags.length > 0 ? [...options.tags] : ['Custom'],
      bannerColor: options.bannerColor || '#EA580C',
    };
  },

  /**
   * Creates a quick timestamped checkpoint profile from the current active loadout
   */
  createCheckpoint(
    activeProfile: ModProfile | undefined,
    installedMods: InstalledMod[],
    sptVersion: string,
    customLabel?: string
  ): ModProfile {
    const now = Date.now();
    const stamp = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const baseName = customLabel?.trim() || `${activeProfile?.name || 'Loadout'} Checkpoint (${stamp})`;
    const enabledModIds = installedMods.filter((m) => !m.isDisabled).map((m) => m.id);
    const customLoadOrder: Record<string, number> = {};
    for (const m of installedMods) {
      if (typeof m.loadOrder === 'number') {
        customLoadOrder[m.id] = m.loadOrder;
      }
    }

    return {
      id: `prof-chk-${now}-${Math.random().toString(36).substring(2, 6)}`,
      name: baseName,
      description: `Rollback checkpoint saved on ${new Date(now).toLocaleString()} for SPT ${sptVersion} (${enabledModIds.length} active mods).`,
      enabledModIds,
      createdDate: new Date(now).toISOString().split('T')[0],
      createdAt: now,
      updatedAt: now,
      isDefault: false,
      customLoadOrder,
      linkedSptProfileId: activeProfile?.linkedSptProfileId,
      linkedSptProfileName: activeProfile?.linkedSptProfileName,
      tags: ['Checkpoint', `SPT ${sptVersion}`],
      bannerColor: '#38BDF8',
    };
  },

  /**
   * Clones an existing profile into a new independent loadout
   */
  cloneProfile(source: ModProfile, newName?: string): ModProfile {
    const now = Date.now();
    return {
      ...source,
      id: `prof-${now}-${Math.random().toString(36).substring(2, 7)}`,
      name: newName?.trim() || `${source.name} (Copy)`,
      description: `Cloned from ${source.name} on ${new Date(now).toLocaleDateString()}`,
      createdDate: new Date(now).toISOString().split('T')[0],
      createdAt: now,
      updatedAt: now,
      isDefault: false,
      enabledModIds: [...source.enabledModIds],
      customLoadOrder: source.customLoadOrder ? { ...source.customLoadOrder } : {},
      modConfigs: source.modConfigs ? JSON.parse(JSON.stringify(source.modConfigs)) : {},
      tags: source.tags ? [...source.tags.filter((t) => t !== 'Default'), 'Cloned'] : ['Cloned'],
    };
  },

  /**
   * Generates a lightweight, reproducible .bsite bundle manifest
   */
  generateBsiteManifest(
    profile: ModProfile,
    installedMods: InstalledMod[],
    targetSptVersion: string,
    author: string = 'Blacksite Operator',
    includeConfigs: boolean = true
  ): BsiteBundleManifest {
    const enabledSet = new Set(profile.enabledModIds.map((id) => id.toLowerCase()));
    const activeMods = installedMods.filter((m) => enabledSet.has(m.id.toLowerCase()));

    const modEntries: BsiteBundleModEntry[] = activeMods.map((mod) => ({
      id: mod.id,
      guid: mod.id,
      name: mod.name,
      version: mod.version,
      author: mod.author,
      sourceHubId: mod.modId,
      required: true,
      loadPriority: profile.customLoadOrder?.[mod.id] ?? mod.loadOrder ?? 100,
      kind: mod.kind,
      downloadUrl: mod.modId ? `https://files.sp-mod.com/mods/${mod.id}-${mod.version}.zip` : undefined,
    }));

    const configOverrides: Record<string, string> = {};
    if (includeConfigs) {
      for (const mod of activeMods) {
        if (mod.configFiles && mod.configFiles.length > 0) {
          for (const cfg of mod.configFiles) {
            if (cfg.content && cfg.content !== cfg.originalContent) {
              configOverrides[cfg.relativePath || cfg.fileName] = cfg.content;
            }
          }
        }
      }
    }

    return {
      formatVersion: '1.0',
      manifestType: 'blacksite_loadout_bundle',
      metadata: {
        name: profile.name,
        description: profile.description,
        author,
        targetSptVersion,
        exportedAt: new Date().toISOString(),
        modCount: modEntries.length,
        tags: profile.tags,
        linkedAccountName: profile.linkedSptProfileName,
      },
      mods: modEntries,
      configOverrides: Object.keys(configOverrides).length > 0 ? configOverrides : undefined,
    };
  },

  /**
   * Encodes a BsiteBundleManifest into a compact BS-... share string
   */
  encodeShareCode(manifest: BsiteBundleManifest): string {
    try {
      const compact = {
        formatVersion: '1.0',
        manifestType: 'blacksite_loadout_bundle',
        metadata: manifest.metadata,
        mods: manifest.mods,
      };
      const json = JSON.stringify(compact);
      return `BS-${btoa(encodeURIComponent(json))}`;
    } catch {
      return '';
    }
  },

  /**
   * Parses raw string/JSON content or a BS-... share code into a validated BsiteBundleManifest
   */
  parseBsiteManifest(rawText: string): BsiteBundleManifest {
    let trimmed = rawText.trim();
    if (trimmed.startsWith('BS-')) {
      try {
        trimmed = decodeURIComponent(atob(trimmed.slice(3)));
      } catch {
        throw new Error('Invalid BS- share code: could not decode base64 payload.');
      }
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid format: Input is neither a valid .bsite/.json manifest nor a valid BS- share code.');
    }

    if (parsed.manifestType === 'blacksite_loadout_bundle' || (parsed.mods && parsed.formatVersion)) {
      if (!Array.isArray(parsed.mods)) {
        throw new Error('Malformed .bsite bundle: missing or invalid "mods" roster array.');
      }
      return {
        formatVersion: '1.0',
        manifestType: 'blacksite_loadout_bundle',
        metadata: {
          name: parsed.metadata?.name || parsed.name || 'Imported Loadout',
          description: parsed.metadata?.description || parsed.description || 'Imported from .bsite bundle',
          author: parsed.metadata?.author || parsed.author || 'Unknown Author',
          targetSptVersion: parsed.metadata?.targetSptVersion || parsed.sptVersion || '4.1.6',
          exportedAt: parsed.metadata?.exportedAt || parsed.exportedAt || new Date().toISOString(),
          modCount: parsed.mods.length,
          tags: parsed.metadata?.tags || ['Imported'],
          linkedAccountName: parsed.metadata?.linkedAccountName,
        },
        mods: parsed.mods.map((m: any) => ({
          id: m.id || m.guid || String(m.name || 'unknown'),
          guid: m.guid || m.id,
          name: m.name || m.id || 'Unnamed Mod',
          version: m.version || '1.0.0',
          author: m.author || 'Author',
          sourceHubId: m.sourceHubId || m.modId,
          required: m.required !== false,
          loadPriority: m.loadPriority || m.loadOrder || 100,
          kind: m.kind || 'Server',
          downloadUrl: m.downloadUrl,
        })),
        configOverrides: parsed.configOverrides || {},
      };
    }

    if (Array.isArray(parsed.mods)) {
      const enabledMods = parsed.mods.filter((m: any) => m.enabled !== false && m.status !== 'disabled');
      return {
        formatVersion: '1.0',
        manifestType: 'blacksite_loadout_bundle',
        metadata: {
          name: parsed.name || 'Imported Loadout',
          description: parsed.description || 'Imported modpack manifest',
          author: parsed.author || 'Community',
          targetSptVersion: parsed.sptVersion || '4.1.6',
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          modCount: enabledMods.length,
          tags: ['Imported'],
        },
        mods: enabledMods.map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version || '1.0.0',
          author: m.author || 'Community',
          required: true,
          loadPriority: m.loadOrder || 100,
          kind: m.kind || 'Server',
        })),
      };
    }

    throw new Error('Unrecognized manifest structure. File does not contain a valid mod list.');
  },

  /**
   * Preflights an imported .bsite bundle against currently installed mods & target SPT version
   */
  preflightBsiteImport(
    manifest: BsiteBundleManifest,
    currentSptVersion: string,
    installedMods: InstalledMod[]
  ): BsiteImportPreflight {
    const installedMap = new Map<string, InstalledMod>();
    for (const mod of installedMods) {
      installedMap.set(mod.id.toLowerCase(), mod);
      if (mod.name) {
        installedMap.set(mod.name.toLowerCase(), mod);
      }
    }

    const existingMods: InstalledMod[] = [];
    const missingMods: BsiteBundleModEntry[] = [];

    for (const modEntry of manifest.mods) {
      const match =
        installedMap.get(modEntry.id.toLowerCase()) ||
        (modEntry.name ? installedMap.get(modEntry.name.toLowerCase()) : undefined);

      if (match) {
        existingMods.push(match);
      } else {
        missingMods.push(modEntry);
      }
    }

    const currentPrefix = currentSptVersion.split('.').slice(0, 2).join('.');
    const targetPrefix = manifest.metadata.targetSptVersion.split('.').slice(0, 2).join('.');
    const isVersionMatch = currentPrefix === targetPrefix || !manifest.metadata.targetSptVersion;

    return {
      manifest,
      isVersionMatch,
      installedCount: existingMods.length,
      missingCount: missingMods.length,
      existingMods,
      missingMods,
    };
  },

  /**
   * Downloads a `.bsite` file locally via standard browser blob save
   */
  exportBsiteFile(manifest: BsiteBundleManifest, filename?: string): void {
    const safeName = (filename || manifest.metadata.name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    const jsonStr = JSON.stringify(manifest, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.bsite`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Scans real SPT Tarkov player accounts from <SPT_Root>/user/profiles/*.json
   */
  async scanSptPlayerProfiles(sptDirectory: string): Promise<SptPlayerProfile[]> {
    const bridge = getDesktopBridge();
    if (bridge?.scanSptPlayerProfiles && sptDirectory) {
      try {
        const diskProfiles = await bridge.scanSptPlayerProfiles({ sptDirectory });
        if (Array.isArray(diskProfiles)) {
          return diskProfiles;
        }
      } catch (err) {
        console.warn('Bridge scanSptPlayerProfiles failed:', err);
      }
    }
    return [];
  },
};

