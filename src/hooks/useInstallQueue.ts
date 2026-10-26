import { useState, useEffect, useCallback } from 'react';
import {
  Addon,
  AddonVersion,
  BsiteBundleModEntry,
  InstalledMod,
  Mod,
  ModVersion,
  QueueItem,
  QueueItemStatus,
  ResolvedDependencyItem,
  SettingsState,
} from '../types';
import { getDesktopBridge } from '../services/desktopBridgeService';
import { apiService } from '../services/apiService';
import { imageCacheService } from '../services/imageCacheService';
import { errorLogService } from '../services/errorLogService';
import { getKnownDependencyMeta } from '../data/knownDependencies';
import { findMatchingModVersion } from '../utils/versionUtils';
import { ManualExtractInfo } from '../components/ManualExtractModal';
import { ShowToastFn } from './useToastQueue';

interface UseInstallQueueParams {
  settings: SettingsState;
  installedMods: InstalledMod[];
  setInstalledMods: React.Dispatch<React.SetStateAction<InstalledMod[]>>;
  setStatusText: (text: string) => void;
  showToast: ShowToastFn;
}

export function useInstallQueue({
  settings,
  installedMods,
  setInstalledMods,
  setStatusText,
  showToast,
}: UseInstallQueueParams) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedModForVersions, setSelectedModForVersions] = useState<Mod | null>(null);
  const [versionRecoveryNotice, setVersionRecoveryNotice] = useState<string | null>(null);
  const [manualExtractInfo, setManualExtractInfo] = useState<ManualExtractInfo | null>(null);

  const [dependencyModalState, setDependencyModalState] = useState<{
    isOpen: boolean;
    targetMod: Mod | null;
    targetVersion: string;
    targetDownloadUrl?: string;
    dependencies: ResolvedDependencyItem[];
  }>({
    isOpen: false,
    targetMod: null,
    targetVersion: '',
    dependencies: [],
  });

  const [addonPromptState, setAddonPromptState] = useState<{
    isOpen: boolean;
    addon: Addon | null;
    addonVersion: AddonVersion | null;
    parentMod: Mod | null;
  }>({
    isOpen: false,
    addon: null,
    addonVersion: null,
    parentMod: null,
  });

  // Real-time IPC download and extraction progress subscription from Electron
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge?.onInstallProgress) {
      const unsubscribe = bridge.onInstallProgress((data) => {
        if (!data?.queueId) return;
        setQueue((prev) =>
          prev.map((item) => {
            if (item.id === data.queueId) {
              const status: QueueItemStatus =
                data.stage === 'installed'
                  ? 'installed'
                  : data.stage === 'extracting'
                  ? 'extracting'
                  : data.stage === 'routing'
                  ? 'routing'
                  : 'downloading';
              return {
                ...item,
                status,
                progressPercent: typeof data.percent === 'number' ? data.percent : item.progressPercent,
                bytesReceived: typeof data.bytesReceived === 'number' ? data.bytesReceived : item.bytesReceived,
                totalBytes:
                  typeof data.totalBytes === 'number' && data.totalBytes > 0
                    ? data.totalBytes
                    : item.totalBytes,
                downloadSpeed: data.downloadSpeed || item.downloadSpeed,
              };
            }
            return item;
          })
        );
        if (data.downloadSpeed) {
          const pct = typeof data.percent === 'number' && data.stage === 'downloading' ? ` (${data.percent}%)` : '';
          setStatusText(`${data.modName || 'Mod'}: ${data.downloadSpeed}${pct}`);
        }
      });
      return () => {
        unsubscribe?.();
      };
    }
  }, [setStatusText]);

  const queueInstall = useCallback(
    async (
      modName: string,
      author: string,
      version: string,
      thumbnail: string,
      guid?: string,
      modId?: number,
      downloadUrl?: string,
      archiveBase64?: string,
      archiveFileName?: string,
      sourceMod?: Mod,
      extraMeta?: Partial<InstalledMod>
    ): Promise<boolean> => {
      const queueId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const targetGuid = guid || `mod.${modName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      if (thumbnail) {
        imageCacheService.fetchAndCache(thumbnail).catch(() => {});
      }

      const totalBytes = 12 * 1024 * 1024;
      const newQueueItem: QueueItem = {
        id: queueId,
        modId: modId || Date.now(),
        modName,
        author,
        version,
        thumbnail,
        status: 'downloading',
        progressPercent: 10,
        bytesReceived: 1000000,
        totalBytes,
        downloadSpeed: 'Initiating...',
        archiveName: archiveFileName || `${targetGuid}-${version}.archive`,
        downloadUrl,
        sourceMod,
      };

      setQueue((prev) => [newQueueItem, ...prev]);
      setStatusText(`Downloading ${modName} v${version}...`);
      showToast('Download Started', `Queued ${modName} v${version} for installation.`, 'info');

      const bridge = getDesktopBridge();

      // Desktop Native Electron Flow
      if (bridge?.installMod) {
        try {
          const installResult = await bridge.installMod({
            queueId,
            sptDirectory: settings.sptDirectory,
            sptVersion: settings.sptVersion,
            modName,
            author,
            version,
            downloadUrl,
            archiveBase64,
            archiveFileName: archiveFileName || `${targetGuid}-${version}.archive`,
            performanceMode: settings.extractionPerformanceMode || 'balanced',
          });

          if (!installResult || !installResult.success) {
            const errObj: Error & {
              code?: string;
              statusCode?: number;
              canManualExtract?: boolean;
              archivePath?: string;
              format?: string;
              destinationDir?: string;
            } = new Error(installResult?.error || 'Installation failed during extraction or folder placement.');
            if (installResult?.errorCode) errObj.code = installResult.errorCode;
            if (installResult?.statusCode) errObj.statusCode = installResult.statusCode;
            if (installResult?.stack) errObj.stack = installResult.stack;
            if (installResult?.canManualExtract) errObj.canManualExtract = installResult.canManualExtract;
            if (installResult?.archivePath) errObj.archivePath = installResult.archivePath;
            if (installResult?.format) errObj.format = installResult.format;
            if (installResult?.destinationDir) errObj.destinationDir = installResult.destinationDir;
            throw errObj;
          }

          setQueue((prev) =>
            prev.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    status: 'installed',
                    progressPercent: 100,
                    downloadSpeed: 'Complete',
                  }
                : item
            )
          );
          setStatusText('Ready');

          const resolvedKind = extraMeta?.kind || installResult.kind || 'Both';
          const isServer = resolvedKind === 'Server' || resolvedKind === 'Both';
          const isClient = resolvedKind === 'Client' || resolvedKind === 'Both';

          setInstalledMods((prev) => {
            const existingIdx = prev.findIndex((m) => m.id === targetGuid);
            const newInstalledMod: InstalledMod = {
              id: targetGuid,
              modId,
              name: modName,
              author: author && author !== 'Forge Dependency' ? author : extraMeta?.author || 'Community Author',
              version,
              kind: resolvedKind,
              thumbnail: thumbnail || extraMeta?.thumbnail,
              categoryTitle: extraMeta?.categoryTitle || (isServer ? 'Overhauls' : 'Tools'),
              teaser: extraMeta?.teaser,
              sptVersion: extraMeta?.sptVersion || settings.sptVersion,
              fikaCompatibility: extraMeta?.fikaCompatibility ?? true,
              installDate: new Date().toISOString().split('T')[0],
              serverPath:
                installResult.serverPath ||
                (isServer ? `${settings.serverModPath}/${modName.replace(/\s+/g, '')}` : undefined),
              clientPath:
                installResult.clientPath ||
                (isClient ? `BepInEx/plugins/${modName.replace(/\s+/g, '')}.dll` : undefined),
              isDisabled: false,
              hasUpdate: false,
              latestVersion: version,
              configFiles: [],
            };

            if (existingIdx >= 0) {
              const copy = [...prev];
              copy[existingIdx] = newInstalledMod;
              return copy;
            }
            return [newInstalledMod, ...prev];
          });

          showToast(
            'Installation Complete',
            `Successfully installed ${modName} v${version} into ${settings.sptDirectory}!`,
            'success'
          );
          return true;
        } catch (rawErr) {
          const err = rawErr as Error & {
            code?: string;
            statusCode?: number;
            canManualExtract?: boolean;
            archivePath?: string;
            format?: string;
          };
          console.error('Desktop install error:', err);
          errorLogService.logError(
            'Installer',
            `Desktop install error on "${modName}" v${version}: ${err.message}`,
            err.stack || String(err),
            modName,
            `bridge.installMod({ mod: "${modName}", url: "${downloadUrl || archiveFileName || 'local'}" })`
          );
          setQueue((prev) =>
            prev.map((item) =>
              item.id === queueId
                ? { ...item, status: 'failed', downloadSpeed: 'Failed', errorMessage: err.message }
                : item
            )
          );
          setStatusText(`Error installing ${modName}`);
          showToast('Installation Failed', err.message || 'Error writing files to SPT directory.', 'error');

          const fallbackVersionEntry: ModVersion = {
            id: Date.now(),
            version,
            description: null,
            link: downloadUrl || null,
            content_length: null,
            spt_version_constraint: settings.sptVersion,
            downloads: 0,
            fika_compatibility: null,
            published_at: new Date().toISOString(),
          };

          const resolvedMod: Mod =
            sourceMod || {
              id: modId || Date.now(),
              name: modName,
              slug: modName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              owner: { id: 0, name: author || 'Community Author', profile_photo_url: null },
              thumbnail: thumbnail || '',
              teaser: extraMeta?.teaser || '',
              downloads: 0,
              favourites_count: 0,
              endorsements_count: 0,
              versions: [fallbackVersionEntry],
            };

          if (
            err.canManualExtract ||
            err.code === 'ERR_EXTRACTION_FAILED' ||
            err.message?.includes('decompression engine') ||
            err.message?.toLowerCase().includes('unable to extract archive')
          ) {
            setManualExtractInfo({
              modName,
              version,
              archivePath: err.archivePath || null,
              format: err.format || null,
              errorMessage: err.message,
              sourceMod: resolvedMod,
            });
            showToast(
              'Decompression Recovery',
              'Archive could not be unpacked automatically. Manual extraction dialog opened.',
              'warning'
            );
          }

          if (
            err.statusCode === 404 ||
            err.code === 'ERR_NOT_FOUND_404' ||
            err.message?.includes('404') ||
            err.message?.toLowerCase().includes('not found')
          ) {
            setVersionRecoveryNotice(
              `The download link for ${modName} v${version} returned HTTP 404 Not Found. This build may have been retired or moved by its author. Please select an active release below.`
            );
            setSelectedModForVersions(resolvedMod);
            showToast(
              'Download Retired (404)',
              `Link for ${modName} v${version} returned 404. Select an alternate release.`,
              'warning'
            );
          }
          return false;
        }
      }

      // Web Fallback Simulation
      return new Promise<boolean>((resolve) => {
        const perfMode = settings.extractionPerformanceMode || 'balanced';
        let currentPercent = 15;

        const tickMs = perfMode === 'turbo' ? 140 : perfMode === 'smooth' ? 320 : 220;
        const speedBase = perfMode === 'turbo' ? 85 : perfMode === 'smooth' ? 14 : 32;

        const interval = setInterval(() => {
          currentPercent += perfMode === 'turbo' ? 22 : perfMode === 'smooth' ? 12 : 16;

          if (currentPercent < 70) {
            const simulatedSpeed = `${(speedBase + Math.random() * 12).toFixed(1)} MB/s${
              perfMode === 'turbo' ? ' (Turbo Max)' : ''
            }`;
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId
                  ? {
                      ...item,
                      status: 'downloading',
                      progressPercent: currentPercent,
                      bytesReceived: Math.floor((currentPercent / 100) * totalBytes),
                      downloadSpeed: simulatedSpeed,
                    }
                  : item
              )
            );
            setStatusText(`Downloading ${modName}: ${simulatedSpeed} (${currentPercent}%)`);
          } else if (currentPercent < 90) {
            const extractDesc =
              perfMode === 'turbo'
                ? 'Turbo Max: All Cores · High Priority'
                : perfMode === 'smooth'
                ? 'Smooth Background Decompression'
                : 'Extracting (7za N-2 Cores)';
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId
                  ? {
                      ...item,
                      status: 'extracting',
                      progressPercent: currentPercent,
                      downloadSpeed: extractDesc,
                    }
                  : item
              )
            );
            setStatusText(`Extracting ${modName} (${extractDesc})...`);
          } else if (currentPercent < 100) {
            const routeDesc =
              perfMode === 'turbo' ? 'Parallel Direct Dispatch to SPT' : 'Placing into SPT_Runtime...';
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId
                  ? {
                      ...item,
                      status: 'routing',
                      progressPercent: currentPercent,
                      downloadSpeed: routeDesc,
                    }
                  : item
              )
            );
            setStatusText(`Routing ${modName} files to SPT...`);
          } else {
            clearInterval(interval);
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId
                  ? {
                      ...item,
                      status: 'installed',
                      progressPercent: 100,
                      downloadSpeed: 'Complete',
                    }
                  : item
              )
            );
            setStatusText('Ready');

            const resolvedKind =
              extraMeta?.kind || (modName.toLowerCase().includes('server') ? 'Server' : 'Both');
            const isServerMod = resolvedKind === 'Server' || resolvedKind === 'Both';
            const serverDir = settings.serverModPath || 'user/mods';
            const clientDir = settings.clientModPath || 'BepInEx/plugins';

            setInstalledMods((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === targetGuid);

              const newInstalledMod: InstalledMod = {
                id: targetGuid,
                modId,
                name: modName,
                author:
                  author && author !== 'Forge Dependency' ? author : extraMeta?.author || 'Community Author',
                version,
                kind: resolvedKind,
                thumbnail: thumbnail || extraMeta?.thumbnail,
                categoryTitle: extraMeta?.categoryTitle || (isServerMod ? 'Overhauls' : 'Tools'),
                teaser: extraMeta?.teaser,
                sptVersion: extraMeta?.sptVersion || settings.sptVersion,
                fikaCompatibility: extraMeta?.fikaCompatibility ?? true,
                installDate: new Date().toISOString().split('T')[0],
                serverPath: `${serverDir}/${modName.replace(/\s+/g, '')}`,
                clientPath: `${clientDir}/${modName.replace(/\s+/g, '')}.dll`,
                isDisabled: false,
                hasUpdate: false,
                latestVersion: version,
                configFiles: [],
              };

              if (existingIdx >= 0) {
                const copy = [...prev];
                copy[existingIdx] = newInstalledMod;
                return copy;
              }
              return [newInstalledMod, ...prev];
            });

            showToast('Installation Complete', `Installed ${modName} v${version}.`, 'success');
            resolve(true);
          }
        }, tickMs);
      });
    },
    [settings, setInstalledMods, setStatusText, showToast]
  );

  const handleInstallMod = useCallback(
    async (
      mod: Mod,
      specificVersion?: string,
      targetSptVersion?: string,
      skipDepCheck = false
    ): Promise<boolean | void> => {
      const activeSpt = targetSptVersion || settings.sptVersion || '4.1.6';
      let version = specificVersion;
      let downloadLink = '';

      if (!downloadLink && mod.id) {
        try {
          const verList = await apiService.getModVersions(mod.id);
          if (verList && verList.length > 0) {
            const targetVer = specificVersion
              ? verList.find((v) => v.version === specificVersion) || verList[0]
              : findMatchingModVersion(verList, activeSpt) || verList[0];
            version = targetVer.version || version;
            downloadLink = targetVer.link || '';
          }
        } catch (err) {
          console.warn('Could not fetch mod versions for download link:', err);
        }
      } else if (mod.versions && mod.versions.length > 0) {
        const verObj = specificVersion
          ? mod.versions.find((v) => v.version === specificVersion)
          : findMatchingModVersion(mod.versions, activeSpt) || mod.versions[0];
        version = verObj?.version || mod.versions[0].version;
        downloadLink = verObj?.link || '';
      }

      const finalVer = version || '1.0.0';

      const modIdentifier = mod.id || mod.guid || mod.slug;
      if (!skipDepCheck && modIdentifier) {
        setStatusText(`Checking Forge dependencies for ${mod.name} (SPT ${activeSpt})...`);
        try {
          const resolvedDeps = await apiService.resolveModDependencies(
            modIdentifier,
            finalVer,
            activeSpt,
            installedMods
          );

          if (resolvedDeps && resolvedDeps.length > 0) {
            setStatusText('Ready');
            setDependencyModalState({
              isOpen: true,
              targetMod: mod,
              targetVersion: finalVer,
              targetDownloadUrl: downloadLink,
              dependencies: resolvedDeps,
            });
            return;
          }
        } catch (depErr) {
          console.warn('Failed resolving dependencies:', depErr);
        }
        setStatusText('Ready');
      }

      return await queueInstall(
        mod.name,
        mod.owner?.name || 'Unknown',
        finalVer,
        mod.thumbnail,
        mod.guid || undefined,
        mod.id,
        downloadLink,
        undefined,
        undefined,
        mod,
        {
          categoryTitle: mod.category?.title,
          teaser: mod.teaser || undefined,
          sptVersion: activeSpt,
        }
      );
    },
    [settings.sptVersion, installedMods, queueInstall, setStatusText]
  );

  const handleConfirmDependencies = useCallback(
    async (selectedDeps: ResolvedDependencyItem[], installStandalone: boolean) => {
      const { targetMod, targetVersion } = dependencyModalState;
      setDependencyModalState({
        isOpen: false,
        targetMod: null,
        targetVersion: '',
        dependencies: [],
      });

      if (!targetMod) return;

      if (installStandalone || selectedDeps.length === 0) {
        showToast(
          'Install Standalone',
          `Installing ${targetMod.name} v${targetVersion} without dependencies.`,
          'info'
        );
        handleInstallMod(targetMod, targetVersion, undefined, true);
        return;
      }

      showToast(
        'Installing Dependencies',
        `Queued ${selectedDeps.length} prerequisites followed by ${targetMod.name}.`,
        'info'
      );

      for (const dep of selectedDeps) {
        const known =
          getKnownDependencyMeta(dep.guid) ||
          getKnownDependencyMeta(dep.name) ||
          getKnownDependencyMeta(dep.id);
        const thumbnail =
          dep.thumbnail ||
          known?.thumbnail ||
          (dep.id ? `https://files.sp-mod.com/mods/${dep.id}.png` : '');
        const author =
          dep.author && dep.author !== 'Forge Dependency' && dep.author !== 'Community Author'
            ? dep.author
            : known?.author || 'Community Author';
        const kind = dep.kind || known?.kind || 'Both';
        const categoryTitle =
          dep.categoryTitle || known?.categoryTitle || (kind === 'Server' ? 'Overhauls' : 'Tools');
        const teaser = dep.teaser || known?.teaser || '';

        const depModObj: Mod = {
          id: dep.id || Date.now(),
          name: dep.name,
          slug: dep.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          owner: { id: 0, name: author, profile_photo_url: null },
          thumbnail,
          teaser,
          downloads: 0,
          favourites_count: 0,
          endorsements_count: 0,
          versions: [
            {
              id: Date.now(),
              version: dep.version,
              description: null,
              link: dep.downloadUrl || null,
              content_length: dep.contentLength ?? null,
              spt_version_constraint: settings.sptVersion,
              downloads: 0,
              fika_compatibility: null,
              published_at: new Date().toISOString(),
            },
          ],
        };

        await queueInstall(
          dep.name,
          author,
          dep.version,
          thumbnail,
          dep.guid,
          dep.id,
          dep.downloadUrl,
          undefined,
          undefined,
          depModObj,
          {
            kind,
            categoryTitle,
            teaser,
            thumbnail,
            fikaCompatibility: true,
          }
        );
      }

      await handleInstallMod(targetMod, targetVersion, undefined, true);
    },
    [dependencyModalState, handleInstallMod, queueInstall, settings.sptVersion, showToast]
  );

  const executeAddonInstall = useCallback(
    async (addon: Addon, version: AddonVersion) => {
      const downloadUrl =
        version.link || `https://sp-mod.com/addon/download/${addon.id}/${addon.slug}/${version.version}`;
      const targetGuid = `addon.${addon.slug || addon.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const addonModObj: Mod = {
        id: addon.id,
        name: addon.name,
        slug: addon.slug || addon.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        owner: { id: 0, name: addon.authors?.[0]?.name || 'Addon Author', profile_photo_url: null },
        thumbnail: addon.thumbnail || addon.mod?.thumbnail || '',
        teaser: addon.teaser || addon.description || `Addon for ${addon.mod?.name || 'SPT'}`,
        downloads: addon.downloads || 0,
        favourites_count: 0,
        endorsements_count: 0,
        versions: [
          {
            id: version.id,
            version: version.version,
            description: version.changelog || null,
            link: downloadUrl,
            content_length: version.content_length ?? null,
            spt_version_constraint: settings.sptVersion,
            downloads: version.downloads || 0,
            fika_compatibility: null,
            published_at: version.published_at || null,
          },
        ],
      };

      await queueInstall(
        addon.name,
        addon.authors?.[0]?.name || 'Addon Author',
        version.version,
        addon.thumbnail || addon.mod?.thumbnail || '',
        targetGuid,
        addon.id,
        downloadUrl,
        undefined,
        undefined,
        addonModObj,
        {
          id: targetGuid,
          name: addon.name,
          author: addon.authors?.[0]?.name || 'Addon Author',
          version: version.version,
          kind: 'Both',
          thumbnail: addon.thumbnail || addon.mod?.thumbnail || '',
          categoryTitle: 'Addons & Presets',
          teaser: addon.teaser || addon.description || `Addon for ${addon.mod?.name || 'SPT'}`,
          sptVersion: settings.sptVersion,
          configFiles: [],
        }
      );
    },
    [queueInstall, settings.sptVersion]
  );

  const handleInstallAddon = useCallback(
    async (addon: Addon, version: AddonVersion) => {
      if (addon.mod_id && addon.mod) {
        const parentName = addon.mod.name.toLowerCase().trim();
        const parentSlug = addon.mod.slug?.toLowerCase().trim();

        const isParentInstalled = installedMods.some((m) => {
          const idLower = m.id.toLowerCase().trim();
          const nameLower = m.name.toLowerCase().trim();
          return (
            idLower === parentName ||
            nameLower === parentName ||
            Boolean(parentSlug && (idLower.includes(parentSlug) || nameLower.includes(parentSlug)))
          );
        });

        if (!isParentInstalled) {
          let fullParentMod: Mod | null = null;
          try {
            fullParentMod = await apiService.getMod(addon.mod_id);
          } catch {
            fullParentMod = null;
          }

          setAddonPromptState({
            isOpen: true,
            addon,
            addonVersion: version,
            parentMod: fullParentMod,
          });
          return;
        }
      }

      executeAddonInstall(addon, version);
    },
    [installedMods, executeAddonInstall]
  );

  const handleConfirmInstallBothAddon = useCallback(async () => {
    const { addon, addonVersion, parentMod } = addonPromptState;
    setAddonPromptState({ isOpen: false, addon: null, addonVersion: null, parentMod: null });

    if (!addon || !addonVersion) return;

    showToast(
      'Installing Parent Mod + Addon',
      `Queuing parent mod ${addon.mod?.name || 'Base Mod'} followed by ${addon.name}.`,
      'info'
    );

    if (parentMod) {
      await handleInstallMod(parentMod, undefined, undefined, true);
    } else if (addon.mod) {
      const mockParent: Mod = {
        id: addon.mod.id,
        name: addon.mod.name,
        slug: addon.mod.slug,
        thumbnail: addon.mod.thumbnail || '',
        owner: {
          id: addon.mod.authors?.[0]?.id || 1,
          name: addon.mod.authors?.[0]?.name || 'Author',
          profile_photo_url: null,
        },
        category: { id: 1, title: 'Base Mods', slug: 'base-mods' },
        downloads: 1000,
        favourites_count: 50,
        endorsements_count: 25,
        versions: addon.mod.latest_version
          ? [
              {
                id: addon.mod.latest_version.id,
                version: addon.mod.latest_version.version,
                link: addon.mod.latest_version.link,
                description: 'Latest release',
                content_length: null,
                spt_version_constraint: '>=3.0.0',
                fika_compatibility: 'compatible',
                published_at: new Date().toISOString(),
                downloads: 1000,
                created_at: new Date().toISOString(),
              },
            ]
          : [],
        created_at: new Date().toISOString(),
      };
      await handleInstallMod(mockParent, undefined, undefined, true);
    }

    await executeAddonInstall(addon, addonVersion);
  }, [addonPromptState, executeAddonInstall, handleInstallMod, showToast]);

  const handleConfirmInstallAddonOnly = useCallback(async () => {
    const { addon, addonVersion } = addonPromptState;
    setAddonPromptState({ isOpen: false, addon: null, addonVersion: null, parentMod: null });

    if (!addon || !addonVersion) return;

    showToast('Installing Addon Only', `Installing ${addon.name} without parent mod.`, 'warning');
    await executeAddonInstall(addon, addonVersion);
  }, [addonPromptState, executeAddonInstall, showToast]);

  const handleSelectVersion = useCallback(
    (mod: Mod, ver: ModVersion) => {
      setVersionRecoveryNotice(null);
      setSelectedModForVersions(null);
      handleInstallMod(mod, ver.version, settings.sptVersion);
    },
    [handleInstallMod, settings.sptVersion]
  );

  const handleInstallFromFile = useCallback(
    (file: File) => {
      const cleanName = file.name.replace(/\.(zip|7z|rar)$/i, '');
      const reader = new FileReader();

      reader.onerror = () => {
        const errMsg = reader.error?.message || 'Failed reading archive buffer (possible browser memory limit).';
        errorLogService.logError(
          'ArchiveExtractor',
          `Failed reading file "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB): ${errMsg}`,
          reader.error?.stack,
          cleanName
        );
        showToast('File Read Error', `Unable to read archive "${file.name}": ${errMsg}`, 'error');
      };

      reader.onload = () => {
        try {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          queueInstall(cleanName, 'Local Archive', '1.0.0', '', undefined, undefined, undefined, base64, file.name);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed reading archive buffer.';
          const stack = err instanceof Error ? err.stack : undefined;
          errorLogService.logError(
            'ArchiveExtractor',
            `Failed converting archive buffer for "${file.name}": ${message}`,
            stack,
            cleanName
          );
          showToast('Archive Error', message, 'error');
        }
      };
      reader.readAsDataURL(file);
    },
    [queueInstall, showToast]
  );

  const handleBatchDownloadMissingMods = useCallback(
    (missingMods: BsiteBundleModEntry[]) => {
      if (missingMods.length === 0) return;
      for (const m of missingMods) {
        queueInstall(
          m.name,
          m.author || 'Forge Author',
          m.version,
          '',
          m.guid || m.id,
          m.sourceHubId,
          m.downloadUrl
        );
      }
      showToast(
        'Batch Download Queued',
        `Queued ${missingMods.length} missing mod${missingMods.length > 1 ? 's' : ''} from .bsite loadout for installation.`,
        'info'
      );
    },
    [queueInstall, showToast]
  );

  return {
    queue,
    setQueue,
    queueInstall,
    handleInstallMod,
    handleConfirmDependencies,
    handleInstallAddon,
    handleConfirmInstallBothAddon,
    handleConfirmInstallAddonOnly,
    handleSelectVersion,
    handleInstallFromFile,
    handleBatchDownloadMissingMods,
    selectedModForVersions,
    setSelectedModForVersions,
    versionRecoveryNotice,
    setVersionRecoveryNotice,
    dependencyModalState,
    setDependencyModalState,
    addonPromptState,
    setAddonPromptState,
    manualExtractInfo,
    setManualExtractInfo,
  };
}
