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
  isDisabled: boolean;
  hasUpdate?: boolean;
  latestVersion?: string;
  conflictId?: string;
  configFiles: ConfigFile[];
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

export interface ConflictInfo {
  id: string;
  conflictingModIds: string[];
  conflictingModNames: string[];
  duplicateItem: string; // filename or package ID
  itemType: 'dll' | 'package_id';
  details: string;
  ignored?: boolean;
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
}

export interface ModProfile {
  id: string;
  name: string;
  description: string;
  enabledModIds: string[];
  createdDate: string;
}

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
