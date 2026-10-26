export interface ModOwner {
  id: number;
  name: string;
  profile_photo_url: string | null;
  cover_photo_url?: string | null;
}

export interface ModCategory {
  id: number;
  hub_id?: number | null;
  title: string;
  slug: string;
  description?: string;
}

export interface SptVersionInfo {
  id: number;
  version: string;
  versionMajor: number;
  versionMinor: number;
  versionPatch: number;
  versionLabels?: string;
  modCount: number;
  link?: string;
  colorClass?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModVersion {
  id: number;
  hub_id?: number | null;
  version: string;
  description: string | null;
  link: string | null;
  content_length: number | null;
  spt_version_constraint: string | null;
  downloads: number;
  fika_compatibility: string | null;
  published_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Mod {
  id: number;
  hub_id?: number | null;
  guid?: string | null;
  name: string;
  slug?: string | null;
  teaser?: string | null;
  thumbnail: string;
  downloads: number;
  favourites_count: number;
  endorsements_count: number;
  detail_url?: string | null;
  featured?: boolean;
  contains_ads?: boolean;
  contains_ai_content?: boolean;
  cheat_notice?: boolean;
  category_id?: number | null;
  fika_compatibility?: boolean | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner?: ModOwner | null;
  additional_authors?: ModOwner[];
  category?: ModCategory | null;
  versions?: ModVersion[];
  dependencies?: string[];
  favorite?: boolean;
}

export interface RecommendedModItem {
  mod: Mod;
  reason: string;
  categoryTitle: string;
  installedCategoryCount: number;
}

export type ModKind = 'Server' | 'Client' | 'Both';

export interface InstalledMod {
  id: string; // packageId or GUID
  modId?: number;
  name: string;
  version: string;
  author: string;
  kind: ModKind;
  categoryTitle?: string;
  thumbnail?: string;
  teaser?: string;
  sptVersion?: string;
  fikaCompatibility?: boolean;
  installDate: string;
  serverPath?: string; // relative to SPT root, e.g. SPT_Runtime/user/mods/xyz
  clientPath?: string; // relative to SPT root, e.g. BepInEx/plugins/xyz.dll
  clientPaths?: string[];
  isDisabled: boolean;
  hasUpdate?: boolean;
  latestVersion?: string;
  latestVersionLink?: string;
  latestVersionId?: number;
  latestContentLength?: number | null;
  conflictId?: string;
  configFiles: ConfigFile[];
  loadOrder?: number;
  dependencies?: string[];
  tags?: ModTag[];
  forgeLinkConfidence?: number; // 0.00 to 1.00
  forgeLinkStatus?: 'linked' | 'quarantine' | 'unlinked';
  forgeCandidateMod?: {
    id: number;
    name: string;
    slug?: string | null;
    author?: string;
    version?: string;
    thumbnail?: string;
  };
  inferredGuid?: string;
  isPatcher?: boolean;
}

export interface ModTag {
  id: string;
  name: string;
  color: string;
}

export interface ConfigFile {
  id: string;
  fileName: string;
  relativePath: string;
  fileType: 'json' | 'jsonc' | 'cfg' | 'yaml';
  content: string;
  originalContent: string;
  backups?: { timestamp: string; content: string }[];
}

export type QueueItemStatus = 'queued' | 'downloading' | 'extracting' | 'routing' | 'installed' | 'failed' | 'paused';

export interface QueueItem {
  id: string;
  modId: number;
  modName: string;
  version: string;
  thumbnail: string;
  author: string;
  status: QueueItemStatus;
  progressPercent: number;
  bytesReceived: number;
  totalBytes: number;
  downloadSpeed: string; // e.g. "12.4 MB/s"
  errorMessage?: string;
  archiveName?: string;
  targetFolder?: string;
  downloadUrl?: string;
  sourceMod?: Mod;
}

export interface ModProfile {
  id: string;
  name: string;
  description: string;
  enabledModIds: string[];
  createdDate: string;
  createdAt?: number;
  updatedAt?: number;
  isDefault?: boolean;
  customLoadOrder?: Record<string, number>;
  linkedSptProfileId?: string; // ID of character profile in user/profiles/*.json
  linkedSptProfileName?: string; // Display name of Tarkov character (e.g. BEAR Level 45)
  modConfigs?: Record<string, Record<string, any>>; // Custom config overrides
  tags?: string[];
  bannerColor?: string; // Tactical accent hex color
}

export type ExtractionPerformanceMode = 'balanced' | 'turbo' | 'smooth';

export interface SettingsState {
  sptDirectory: string;
  sptVersion: string;
  detectedServerBinary: string;
  clientModPath: string; // BepInEx/plugins
  serverModPath: string; // SPT_Runtime/user/mods
  isSpt4xLayout: boolean;
  activeProfileId: string;
  autoCheckUpdates: boolean;
  downloadStallTimeoutSeconds: number;
  theme: 'dark' | 'light';
  showRecommendedMods?: boolean;
  extractionPerformanceMode?: ExtractionPerformanceMode;
}

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

export type CatalogSortOption =
  | 'downloads'
  | 'recent'
  | 'name_az'
  | 'name_za'
  | 'endorsements'
  | 'favourites';

export interface ForgeDependencyNode {
  id: number;
  guid?: string;
  name: string;
  slug?: string;
  latest_compatible_version?: {
    id: number;
    version: string;
    link: string;
    content_length?: number | null;
    fika_compatibility?: string;
  } | null;
  conflict: boolean;
  dependencies?: ForgeDependencyNode[];
}

export interface ResolvedDependencyItem {
  id: number;
  guid: string;
  name: string;
  slug: string;
  version: string;
  downloadUrl: string;
  contentLength?: number | null;
  conflict: boolean;
  isInstalled: boolean;
  installedVersion?: string;
  selected: boolean;
  depth: number;
  thumbnail?: string;
  author?: string;
  kind?: ModKind;
  categoryTitle?: string;
  teaser?: string;
}

export interface AddonVersion {
  id: number;
  addon_id: number;
  version: string;
  slug: string;
  link: string;
  changelog?: string;
  content_length?: number | null;
  downloads?: number;
  published_at?: string;
  mod_version_constraint?: string | null;
}

export interface Addon {
  id: number;
  name: string;
  slug: string;
  teaser?: string;
  description?: string;
  mod_id: number;
  category_id?: number;
  downloads?: number;
  rating?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  thumbnail?: string;
  authors?: {
    id: number;
    name: string;
    avatar?: string;
    roles?: string[];
  }[];
  versions?: AddonVersion[];
  mod?: {
    id: number;
    name: string;
    slug: string;
    thumbnail?: string;
    authors?: {
      id: number;
      name: string;
    }[];
    latest_version?: {
      id: number;
      version: string;
      link: string;
    };
  };
}

export interface AddonQueryResult {
  data: Addon[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  isOfflineFallback?: boolean;
}

// ==========================================
// Phase 3: Conflict Matrix & VFS Types
// ==========================================

export type FileCollisionType = 'CRITICAL_BINARY' | 'CONFIG_OVERWRITE' | 'ASSET_OVERRIDE';

export interface FileCollisionContender {
  modId: string;
  modName: string;
  version: string;
  loadOrder?: number;
  isDirectLink?: boolean;
}

export interface FileCollision {
  collisionId: string;
  type: FileCollisionType;
  relativePath: string;
  severity: 'critical' | 'warning' | 'info';
  contenders: FileCollisionContender[];
  details: string;
  recommendedAction: 'prioritize_higher' | 'disable_mod' | 'sandbox_config';
  ignored?: boolean;
}

export interface CircularDependencyCycle {
  cycleId: string;
  modIds: string[];
  modNames: string[];
  pathRepresentation: string;
  description: string;
  breakRecommendation: {
    sourceModId: string;
    sourceModName: string;
    targetModId: string;
    targetModName: string;
    suggestedAction: 'adjust_load_order' | 'disable_mod';
  };
}

export interface MissingPrerequisite {
  id: string;
  consumerModId: string;
  consumerModName: string;
  requiredModId: string;
  requiredModName: string;
  versionConstraint?: string;
  forgeModId?: number;
  isInstalledButDisabled: boolean;
}

export interface ConflictMatrixReport {
  cycles: CircularDependencyCycle[];
  collisions: FileCollision[];
  missingPrerequisites: MissingPrerequisite[];
  criticalCount: number;
  warningCount: number;
  circularCount: number;
  totalIssuesCount: number;
  topologicalLoadOrder: string[];
  hasCycle: boolean;
  timestamp: string;
}

// ==========================================
// Phase 4: Tactical Mod Profiles & .bsite Hub
// ==========================================

export interface SptPlayerProfile {
  id: string; // e.g. "65a1b2c3d4e5f67890" or "Account-Alpha"
  name: string;
  side: 'Bear' | 'Usec' | 'Unknown';
  level: number;
  experience: number;
  edition: string;
  wipeVersion?: string;
  lastPlayed?: string;
}

export interface ProfileDiffResult {
  profileA: ModProfile;
  profileB: ModProfile;
  commonMods: InstalledMod[];
  onlyInProfileA: InstalledMod[];
  onlyInProfileB: InstalledMod[];
  versionMismatches: {
    modId: string;
    modName: string;
    versionA: string;
    versionB: string;
  }[];
  loadOrderMismatches: {
    modId: string;
    modName: string;
    orderA?: number;
    orderB?: number;
  }[];
}

export interface BsiteBundleModEntry {
  id: string;
  guid?: string;
  name: string;
  version: string;
  author?: string;
  downloadUrl?: string;
  sourceHubId?: number;
  required: boolean;
  loadPriority?: number;
  kind?: ModKind;
}

export interface BsiteBundleManifest {
  formatVersion: '1.0';
  manifestType: 'blacksite_loadout_bundle';
  metadata: {
    name: string;
    description: string;
    author: string;
    targetSptVersion: string;
    exportedAt: string;
    modCount: number;
    tags?: string[];
    linkedAccountName?: string;
  };
  mods: BsiteBundleModEntry[];
  configOverrides?: Record<string, string>; // relative path -> serialized JSON/INI content
}

export interface BsiteImportPreflight {
  manifest: BsiteBundleManifest;
  isVersionMatch: boolean;
  installedCount: number;
  missingCount: number;
  existingMods: InstalledMod[];
  missingMods: BsiteBundleModEntry[];
}

export interface CheckModUpdatesResult {
  hasUpdates: boolean;
  updatesCount: number;
  updatedMods: {
    installedModId: string;
    modId?: number;
    guid?: string;
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
    versionId?: number;
    contentLength?: number | null;
    fikaCompatibility?: boolean;
    changeSummary?: string;
  }[];
  upToDateCount: number;
  incompatibleCount: number;
}

// ==========================================
// Electron Desktop IPC Bridge Types
// ==========================================

export interface DesktopSptDirectoryInfo {
  normalizedPath?: string;
  sptVersion?: string;
  detectedServerBinary?: string;
  serverModPath?: string;
  clientModPath?: string;
  isSpt4xLayout?: boolean;
}

export interface DesktopInstallProgressEvent {
  queueId: string;
  modName?: string;
  stage?: 'downloading' | 'extracting' | 'routing' | 'installed';
  percent?: number;
  bytesReceived?: number;
  totalBytes?: number;
  downloadSpeed?: string;
}

export interface DesktopInstallModParams {
  queueId: string;
  sptDirectory: string;
  sptVersion: string;
  modName: string;
  author: string;
  version: string;
  downloadUrl?: string;
  archiveBase64?: string;
  archiveFileName?: string;
  performanceMode?: ExtractionPerformanceMode;
}

export interface DesktopInstallModResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  stack?: string;
  canManualExtract?: boolean;
  archivePath?: string;
  format?: string;
  destinationDir?: string;
  kind?: ModKind;
  serverPath?: string;
  clientPath?: string;
}

export interface DesktopUninstallModParams {
  sptDirectory: string;
  serverPath?: string;
  clientPath?: string;
  modName?: string;
  clientPaths?: string[];
}

export interface DesktopToggleDisableParams {
  sptDirectory: string;
  serverPath?: string;
  clientPath?: string;
  clientPaths?: string[];
  disable: boolean;
}

export interface DesktopToggleDisableResult {
  success?: boolean;
  serverPath?: string;
  clientPath?: string;
  clientPaths?: string[];
}

export interface DesktopVfsRelinkResult {
  success: boolean;
  switchedCount: number;
  durationMs: number;
}

export interface DesktopClearTempResult {
  reclaimedBytes?: number;
  deletedCount?: number;
}

export interface DesktopSptStatusResult {
  isRunning: boolean;
  hasLaunchedClient?: boolean;
}

export interface DesktopServerLogEvent {
  text: string;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
}

export interface DesktopWindowControlAPI {
  minimize: () => Promise<void> | void;
  maximize: () => Promise<boolean>;
  close: () => Promise<void> | void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange?: (callback: (isMaximized: boolean) => void) => () => void;
}

export interface DesktopBridgeAPI {
  isElectron: boolean;
  platform: string;
  version: string;
  cpuCount: number;
  selectDirectory?: (defaultPath?: string) => Promise<string | null>;
  inspectSptDirectory?: (targetPath: string) => Promise<DesktopSptDirectoryInfo | null>;
  fetchImageDataUrl?: (url: string) => Promise<string | null>;
  openFolder?: (targetPath: string) => Promise<boolean>;
  showItemInFolder?: (targetPath: string) => Promise<boolean>;
  openExternal?: (url: string) => Promise<boolean>;
  installMod?: (params: DesktopInstallModParams) => Promise<DesktopInstallModResult>;
  onInstallProgress?: (callback: (data: DesktopInstallProgressEvent) => void) => () => void;
  uninstallMod?: (params: DesktopUninstallModParams) => Promise<void>;
  uninstallAllMods?: (params: { sptDirectory: string }) => Promise<void>;
  toggleDisableMod?: (params: DesktopToggleDisableParams) => Promise<DesktopToggleDisableResult | null>;
  scanInstalledMods?: (params: { sptDirectory: string }) => Promise<Partial<InstalledMod>[]>;
  saveModConfigFile?: (params: { sptDirectory: string; relativePath: string; content: string }) => Promise<void>;
  relinkVfsProfile?: (params: {
    sptDirectory: string;
    enabledModIds: string[];
    disabledModIds: string[];
  }) => Promise<DesktopVfsRelinkResult | null>;
  scanSptPlayerProfiles?: (params: { sptDirectory: string }) => Promise<SptPlayerProfile[]>;
  clearTempFiles?: (params: { sptDirectory: string }) => Promise<DesktopClearTempResult | null>;
  launchSpt?: (params: { sptDirectory: string; sptVersion: string }) => Promise<{ success: boolean; error?: string }>;
  stopSptServer?: () => Promise<void>;
  getSptStatus?: () => Promise<DesktopSptStatusResult | null>;
  onSptServerLog?: (callback: (data: DesktopServerLogEvent) => void) => () => void;
  onSptClientLaunched?: (callback: (data: { launcherName: string }) => void) => () => void;
  onSptServerExit?: (callback: (data: { code: number; signal?: string }) => void) => () => void;
  setCustomEmblem?: (dataUrl: string) => Promise<void> | void;
  updateAppIcon?: (buffer: ArrayBuffer) => Promise<void> | void;
  resetCustomEmblem?: () => Promise<void> | void;
  windowControl?: DesktopWindowControlAPI;
}


