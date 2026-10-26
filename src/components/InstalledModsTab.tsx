import React, { useState, useMemo, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Trash2,
  ArrowUpCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
  Layers,
  Tag,
  CheckSquare,
  Sparkles,
  Calendar,
  FolderTree,
  ChevronRight,
  Download,
} from 'lucide-react';
import { InstalledMod, FileCollision, ModKind, ModTag } from '../types';
import { InstalledSearchBar } from './InstalledSearchBar';
import { TagEditorModal } from './TagEditorModal';
import { ExportModsModal } from './ExportModsModal';
import { BatchModUpdateModal } from './BatchModUpdateModal';
import { InstalledModsStatsBar } from './installed/InstalledModsStatsBar';
import { InstalledModRowCard, ModDependencyStatus } from './installed/InstalledModRowCard';
import { TacticalConfirmModal } from './TacticalConfirmModal';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

export type InstalledSortField =
  | 'loadOrder'
  | 'name'
  | 'date'
  | 'date-desc'
  | 'date-asc'
  | 'category'
  | 'status'
  | 'author';
export type GroupByMode = 'none' | 'category' | 'date';

interface InstalledModsTabProps {
  installedMods: InstalledMod[];
  collisions: FileCollision[];
  sptVersion?: string;
  onToggleMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onUpdateMod: (mod: InstalledMod) => Promise<boolean | void> | void;
  onEditConfigs: (mod: InstalledMod) => void;
  onNavigateConflicts: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onUninstallAll: () => void;
  onCheckUpdates: () => void;
  onOpenFolder: (target: 'client' | 'server' | string | string[]) => void;
  onReorderMods: (reorderedMods: InstalledMod[]) => void;
  onUpdateModTags: (modId: string, tags: ModTag[]) => void;
  onBulkEnable?: (modIds: string[]) => void;
  onBulkDisable?: (modIds: string[]) => void;
  onBulkUninstall?: (modIds: string[]) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  activeSortField?: InstalledSortField;
  activeSortDirection?: 'asc' | 'desc';
  onSortChange?: (field: InstalledSortField, direction: 'asc' | 'desc') => void;
}

const DEFAULT_DEP_STATUS: ModDependencyStatus = {
  hasMissing: false,
  missingUninstalled: [],
  missingDisabled: [],
  allMissing: [],
};

export const InstalledModsTab: React.FC<InstalledModsTabProps> = ({
  installedMods,
  collisions,
  sptVersion,
  onToggleMod,
  onUninstallMod,
  onUpdateMod,
  onEditConfigs,
  onNavigateConflicts,
  onEnableAll,
  onDisableAll,
  onUninstallAll,
  onCheckUpdates,
  onOpenFolder,
  onReorderMods,
  onUpdateModTags,
  onBulkEnable,
  onBulkDisable,
  onBulkUninstall,
  onShowToast,
  activeSortField,
  activeSortDirection,
  onSortChange,
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedKind, setSelectedKind] = useState<ModKind | 'All'>('All');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('All');
  const [localSortField, setLocalSortField] = useState<InstalledSortField>('loadOrder');
  const [localSortDirection, setLocalSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortField = activeSortField ?? localSortField;
  const sortDirection = activeSortDirection ?? localSortDirection;

  const [updatesFirst, setUpdatesFirst] = useState(false);
  const [hideDisabled, setHideDisabled] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);

  // Auto-Sort & Grouping state
  const [showAutoSortMenu, setShowAutoSortMenu] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Multi-Select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set());

  // Drag and drop state
  const [draggingModId, setDraggingModId] = useState<string | null>(null);
  const [dragOverModId, setDragOverModId] = useState<string | null>(null);

  // Tag editing modal state
  const [tagModalMod, setTagModalMod] = useState<InstalledMod | null>(null);

  // Export mods modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // 1-Click Batch Mod Updater state
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchUpdateMods, setBatchUpdateMods] = useState<InstalledMod[]>([]);

  const { requestConfirm, confirmModalProps } = useConfirmDialog();

  // Precomputed O(1) counts & lookup maps
  const { activeCount, disabledCount, updateCount, kindCounts } = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let updates = 0;
    const kinds: Record<ModKind, number> = { Server: 0, Client: 0, Both: 0 };

    for (const m of installedMods) {
      if (m.isDisabled) disabled++;
      else active++;
      if (m.hasUpdate) updates++;
      if (m.kind && kinds[m.kind] !== undefined) {
        kinds[m.kind]++;
      }
    }

    return {
      activeCount: active,
      disabledCount: disabled,
      updateCount: updates,
      kindCounts: kinds,
    };
  }, [installedMods]);

  const selectedModsWithUpdatesCount = useMemo(
    () => installedMods.filter((m) => selectedModIds.has(m.id) && m.hasUpdate).length,
    [installedMods, selectedModIds]
  );

  // Precompute active collision lookup map by modId in O(1)
  const collisionByModIdMap = useMemo(() => {
    const map = new Map<string, FileCollision>();
    for (const c of collisions) {
      if (c.ignored) continue;
      for (const ct of c.contenders) {
        if (!map.has(ct.modId)) {
          map.set(ct.modId, c);
        }
      }
    }
    return map;
  }, [collisions]);

  // Compute all unique tags and tag counts across installed mods
  const { allExistingTags, tagCountMap } = useMemo(() => {
    const map = new Map<string, ModTag>();
    const counts = new Map<string, number>();

    for (const m of installedMods) {
      if (!m.tags) continue;
      for (const t of m.tags) {
        const key = t.name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, t);
        }
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return {
      allExistingTags: Array.from(map.values()),
      tagCountMap: counts,
    };
  }, [installedMods]);

  // Compute Missing Dependencies Map for all installed mods
  const dependencyStatusMap = useMemo(() => {
    const installedIdMap = new Map<string, InstalledMod>();
    for (const m of installedMods) {
      installedIdMap.set(m.id.toLowerCase(), m);
    }

    const statusMap = new Map<string, ModDependencyStatus>();

    for (const mod of installedMods) {
      const deps = mod.dependencies || [];
      const missingUninstalled: string[] = [];
      const missingDisabled: { id: string; name: string }[] = [];

      for (const depId of deps) {
        const found = installedIdMap.get(depId.toLowerCase());
        if (!found) {
          missingUninstalled.push(depId);
        } else if (found.isDisabled) {
          missingDisabled.push({ id: found.id, name: found.name });
        }
      }

      const allMissing = [
        ...missingUninstalled,
        ...missingDisabled.map((d) => `${d.name} (Disabled)`),
      ];

      statusMap.set(mod.id, {
        hasMissing: allMissing.length > 0,
        missingUninstalled,
        missingDisabled,
        allMissing,
      });
    }

    return statusMap;
  }, [installedMods]);

  const modsWithMissingDepsCount = useMemo(() => {
    let count = 0;
    dependencyStatusMap.forEach((status) => {
      if (status.hasMissing) count++;
    });
    return count;
  }, [dependencyStatusMap]);

  // Automated load order reorganization by Category, Install Date, or Dependencies
  const handleApplyAutoSort = useCallback(
    (mode: 'category' | 'date-desc' | 'date-asc' | 'smart-deps') => {
      const enabledMods = installedMods.filter((m) => !m.isDisabled);
      const disabledMods = installedMods.filter((m) => m.isDisabled);
      const sortedEnabled = [...enabledMods];

      if (mode === 'category') {
        const kindPriority: Record<ModKind, number> = { Server: 1, Both: 2, Client: 3 };
        sortedEnabled.sort((a, b) => {
          const pA = kindPriority[a.kind] || 4;
          const pB = kindPriority[b.kind] || 4;
          if (pA !== pB) return pA - pB;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        setLocalSortField('category');
        setLocalSortDirection('asc');
        onSortChange?.('category', 'asc');
        onShowToast(
          'Auto-Sorted by Category',
          `Reorganized ${sortedEnabled.length} active mods: Server mods first (#1), then Dual mods, then Client plugins.`,
          'success'
        );
      } else if (mode === 'date-desc') {
        sortedEnabled.sort((a, b) => {
          const tA = new Date(a.installDate).getTime() || 0;
          const tB = new Date(b.installDate).getTime() || 0;
          if (tA !== tB) return tB - tA;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        setLocalSortField('date-desc');
        setLocalSortDirection('desc');
        onSortChange?.('date-desc', 'desc');
        onShowToast(
          'Auto-Sorted by Install Date',
          `Reorganized ${sortedEnabled.length} active mods: Newest installations first (#1).`,
          'success'
        );
      } else if (mode === 'date-asc') {
        sortedEnabled.sort((a, b) => {
          const tA = new Date(a.installDate).getTime() || 0;
          const tB = new Date(b.installDate).getTime() || 0;
          if (tA !== tB) return tA - tB;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        setLocalSortField('date-asc');
        setLocalSortDirection('asc');
        onSortChange?.('date-asc', 'asc');
        onShowToast(
          'Auto-Sorted Chronologically',
          `Reorganized ${sortedEnabled.length} active mods: Oldest installations first (#1).`,
          'success'
        );
      } else if (mode === 'smart-deps') {
        const depTargetFrequency = new Map<string, number>();
        for (const m of installedMods) {
          m.dependencies?.forEach((d) => {
            depTargetFrequency.set(d.toLowerCase(), (depTargetFrequency.get(d.toLowerCase()) || 0) + 1);
          });
        }

        sortedEnabled.sort((a, b) => {
          const aIsCore =
            a.name.toLowerCase().includes('commonlib') ||
            a.id.toLowerCase().includes('commonlib') ||
            a.id.toLowerCase().includes('bigbrain') ||
            a.tags?.some((t) => t.name.toLowerCase().includes('core') || t.name.toLowerCase().includes('dependency'));
          const bIsCore =
            b.name.toLowerCase().includes('commonlib') ||
            b.id.toLowerCase().includes('commonlib') ||
            b.id.toLowerCase().includes('bigbrain') ||
            b.tags?.some((t) => t.name.toLowerCase().includes('core') || t.name.toLowerCase().includes('dependency'));

          if (aIsCore && !bIsCore) return -1;
          if (!aIsCore && bIsCore) return 1;

          const freqA = depTargetFrequency.get(a.id.toLowerCase()) || 0;
          const freqB = depTargetFrequency.get(b.id.toLowerCase()) || 0;
          if (freqA !== freqB) return freqB - freqA;

          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        setLocalSortField('loadOrder');
        setLocalSortDirection('asc');
        onSortChange?.('loadOrder', 'asc');
        onShowToast(
          'Smart Dependency Auto-Sort',
          'Assigned optimal load order: Core libraries and prerequisites loaded first.',
          'success'
        );
      }

      const nextInstalledMods = [
        ...sortedEnabled.map((mod, index) => ({
          ...mod,
          loadOrder: index + 1,
        })),
        ...disabledMods,
      ];

      onReorderMods(nextInstalledMods);
      setShowAutoSortMenu(false);
    },
    [installedMods, onReorderMods, onShowToast, onSortChange]
  );

  const handleSortFieldChange = (newField: InstalledSortField) => {
    const nextDir: 'asc' | 'desc' = newField === 'date-desc' || newField === 'date' ? 'desc' : 'asc';
    setLocalSortField(newField);
    setLocalSortDirection(nextDir);
    onSortChange?.(newField, nextDir);

    if (newField === 'category') {
      handleApplyAutoSort('category');
    } else if (newField === 'date-desc' || newField === 'date') {
      handleApplyAutoSort('date-desc');
    } else if (newField === 'date-asc') {
      handleApplyAutoSort('date-asc');
    }
  };

  const handleToggleSortDirection = () => {
    const nextDir = sortDirection === 'asc' ? 'desc' : 'asc';
    setLocalSortDirection(nextDir);
    onSortChange?.(sortField, nextDir);
  };

  const toggleCollapseGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleReorder = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      const enabledMods = installedMods
        .filter((m) => !m.isDisabled)
        .sort((a, b) => (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999));

      const draggedIdx = enabledMods.findIndex((m) => m.id === draggedId);
      const targetIdx = enabledMods.findIndex((m) => m.id === targetId);

      if (draggedIdx === -1 || targetIdx === -1) return;

      const reorderedList = [...enabledMods];
      const [moved] = reorderedList.splice(draggedIdx, 1);
      reorderedList.splice(targetIdx, 0, moved);

      const newOrderMap = new Map<string, number>();
      reorderedList.forEach((mod, index) => {
        newOrderMap.set(mod.id, index + 1);
      });

      const nextInstalledMods = installedMods.map((mod) => {
        if (newOrderMap.has(mod.id)) {
          return {
            ...mod,
            loadOrder: newOrderMap.get(mod.id)!,
          };
        }
        return mod;
      });

      onReorderMods(nextInstalledMods);
      setLocalSortField('loadOrder');
      setLocalSortDirection('asc');
      onSortChange?.('loadOrder', 'asc');
      onShowToast(
        'Load Order Updated',
        `Moved "${moved.name}" to position #${targetIdx + 1}.`,
        'success'
      );
    },
    [installedMods, onReorderMods, onShowToast, onSortChange]
  );

  const handleMoveStep = useCallback(
    (modId: string, direction: 'up' | 'down') => {
      const enabledMods = installedMods
        .filter((m) => !m.isDisabled)
        .sort((a, b) => (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999));
      const currentIndex = enabledMods.findIndex((m) => m.id === modId);
      if (currentIndex === -1) return;
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= enabledMods.length) return;

      handleReorder(modId, enabledMods[targetIndex].id);
    },
    [installedMods, handleReorder]
  );

  // Memoized filtered & sorted list
  const displayed = useMemo(() => {
    let list = [...installedMods];

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q) ||
          (m.categoryTitle && m.categoryTitle.toLowerCase().includes(q)) ||
          (m.kind && m.kind.toLowerCase().includes(q)) ||
          (m.kind === 'Client' && 'client plugin'.includes(q)) ||
          (m.kind === 'Server' && 'server mod'.includes(q)) ||
          (m.kind === 'Both' && ('dual'.includes(q) || 'hybrid'.includes(q))) ||
          m.id.toLowerCase().includes(q) ||
          (m.teaser && m.teaser.toLowerCase().includes(q)) ||
          (m.serverPath && m.serverPath.toLowerCase().includes(q)) ||
          (m.clientPath && m.clientPath.toLowerCase().includes(q)) ||
          m.tags?.some((t) => t.name.toLowerCase().includes(q))
      );
    }

    if (selectedKind !== 'All') {
      list = list.filter((m) => m.kind === selectedKind);
    }

    if (selectedTagFilter !== 'All') {
      const tagLower = selectedTagFilter.toLowerCase();
      list = list.filter((m) => m.tags?.some((t) => t.name.toLowerCase() === tagLower));
    }

    if (filterMissingOnly) {
      list = list.filter((m) => dependencyStatusMap.get(m.id)?.hasMissing);
    }

    if (hideDisabled) {
      list = list.filter((m) => !m.isDisabled);
    }

    list.sort((a, b) => {
      if (updatesFirst) {
        if (a.hasUpdate && !b.hasUpdate) return -1;
        if (!a.hasUpdate && b.hasUpdate) return 1;
      }

      let comparison = 0;

      switch (sortField) {
        case 'loadOrder': {
          if (a.isDisabled !== b.isDisabled) {
            comparison = a.isDisabled ? 1 : -1;
          } else {
            comparison = (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999);
          }
          break;
        }
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'category': {
          const orderMap: Record<ModKind, number> = { Server: 1, Both: 2, Client: 3 };
          const catA = orderMap[a.kind] || 4;
          const catB = orderMap[b.kind] || 4;
          if (catA !== catB) {
            comparison = catA - catB;
          } else {
            comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          }
          break;
        }
        case 'date':
        case 'date-desc':
        case 'date-asc': {
          const timeA = new Date(a.installDate).getTime() || 0;
          const timeB = new Date(b.installDate).getTime() || 0;
          comparison = timeA - timeB;
          break;
        }
        case 'status': {
          const statusA = a.isDisabled ? 1 : 0;
          const statusB = b.isDisabled ? 1 : 0;
          comparison = statusA - statusB;
          if (comparison === 0) {
            comparison = (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999);
          }
          break;
        }
        case 'author':
          comparison = a.author.localeCompare(b.author, undefined, { sensitivity: 'base' });
          break;
        default:
          comparison = (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [
    installedMods,
    searchText,
    selectedKind,
    selectedTagFilter,
    filterMissingOnly,
    hideDisabled,
    updatesFirst,
    sortField,
    sortDirection,
    dependencyStatusMap,
  ]);

  // Multi-Select helpers
  const toggleSelectMod = useCallback((modId: string, enableMultiSelect = false) => {
    if (enableMultiSelect) {
      setIsMultiSelectMode(true);
    }
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) {
        next.delete(modId);
      } else {
        next.add(modId);
      }
      return next;
    });
  }, []);

  const selectAllDisplayed = () => {
    setSelectedModIds(new Set(displayed.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelectedModIds(new Set());
  };

  const invertSelection = () => {
    setSelectedModIds((prev) => {
      const next = new Set<string>();
      for (const m of displayed) {
        if (!prev.has(m.id)) {
          next.add(m.id);
        }
      }
      return next;
    });
  };

  const handleApplyBulkEnable = () => {
    const ids = Array.from(selectedModIds);
    if (ids.length === 0) return;
    if (onBulkEnable) {
      onBulkEnable(ids);
    } else {
      ids.forEach((id) => {
        const mod = installedMods.find((m) => m.id === id);
        if (mod && mod.isDisabled) onToggleMod(id);
      });
      onShowToast('Bulk Enable', `Enabled ${ids.length} selected mods.`, 'success');
    }
    clearSelection();
  };

  const handleApplyBulkDisable = () => {
    const ids = Array.from(selectedModIds);
    if (ids.length === 0) return;
    if (onBulkDisable) {
      onBulkDisable(ids);
    } else {
      ids.forEach((id) => {
        const mod = installedMods.find((m) => m.id === id);
        if (mod && !mod.isDisabled) onToggleMod(id);
      });
      onShowToast('Bulk Disable', `Disabled ${ids.length} selected mods.`, 'warning');
    }
    clearSelection();
  };

  const handleApplyBulkUninstall = async () => {
    const ids = Array.from(selectedModIds);
    if (ids.length === 0) return;
    if (onBulkUninstall) {
      onBulkUninstall(ids);
    } else {
      const confirmed = await requestConfirm({
        title: 'Bulk Uninstall Mods',
        message: `Permanently uninstall ${ids.length} selected mod${ids.length > 1 ? 's' : ''} and delete their files from disk?`,
        confirmLabel: 'Uninstall Selected',
        severity: 'danger',
      });
      if (confirmed) {
        ids.forEach((id) => onUninstallMod(id));
        onShowToast('Bulk Uninstall', `Uninstalled ${ids.length} mods.`, 'warning');
      }
    }
    clearSelection();
  };

  const handleEnableGroupMods = (modsToEnable: InstalledMod[]) => {
    if (onBulkEnable) {
      onBulkEnable(modsToEnable.map((m) => m.id));
    } else {
      modsToEnable.forEach((m) => {
        if (m.isDisabled) onToggleMod(m.id);
      });
    }
  };

  const handleDisableGroupMods = (modsToDisable: InstalledMod[]) => {
    if (onBulkDisable) {
      onBulkDisable(modsToDisable.map((m) => m.id));
    } else {
      modsToDisable.forEach((m) => {
        if (!m.isDisabled) onToggleMod(m.id);
      });
    }
  };

  const handleSelectGroupMods = (modsToSelect: InstalledMod[]) => {
    setIsMultiSelectMode(true);
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      modsToSelect.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const categoryGroups = useMemo(
    () => [
      {
        id: 'group-server',
        title: 'Server Mods',
        subtitle: 'SPT_Runtime/user/mods (or user/mods)',
        icon: '🖥️',
        bgColor: 'bg-[#3A2415]/40',
        mods: displayed.filter((m) => m.kind === 'Server'),
      },
      {
        id: 'group-both',
        title: 'Dual / Hybrid Mods',
        subtitle: 'Combined Server scripts & BepInEx Client plugins',
        icon: '⚡',
        bgColor: 'bg-[#22102A]/40',
        mods: displayed.filter((m) => m.kind === 'Both'),
      },
      {
        id: 'group-client',
        title: 'Client Plugins',
        subtitle: 'BepInEx/plugins',
        icon: '🧩',
        bgColor: 'bg-[#0D2428]/40',
        mods: displayed.filter((m) => m.kind === 'Client'),
      },
    ],
    [displayed]
  );

  const dateGroups = useMemo(() => {
    const now = Date.now();
    const recent: InstalledMod[] = [];
    const earlier: InstalledMod[] = [];
    const older: InstalledMod[] = [];

    for (const m of displayed) {
      const t = new Date(m.installDate).getTime();
      if (!t) {
        older.push(m);
        continue;
      }
      const days = Math.floor((now - t) / (1000 * 60 * 60 * 24));
      if (days <= 7) recent.push(m);
      else if (days <= 30) earlier.push(m);
      else older.push(m);
    }

    return [
      { id: 'date-recent', title: 'Recent Installations (Last 7 Days)', icon: '🔥', mods: recent, bgColor: 'bg-[#3A2415]/40' },
      { id: 'date-earlier', title: 'Earlier This Month', icon: '📅', mods: earlier, bgColor: 'bg-[#182038]/40' },
      { id: 'date-older', title: 'Older Installations', icon: '📦', mods: older, bgColor: 'bg-[#1E232B]/40' },
    ];
  }, [displayed]);

  const handleCardDragStart = useCallback(
    (modId: string, e: React.DragEvent) => {
      if (isMultiSelectMode) return;
      setDraggingModId(modId);
      e.dataTransfer.setData('text/plain', modId);
      e.dataTransfer.effectAllowed = 'move';
    },
    [isMultiSelectMode]
  );

  const handleCardDragOver = useCallback(
    (modId: string, e: React.DragEvent) => {
      if (isMultiSelectMode) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverModId((prev) => (prev !== modId ? modId : prev));
    },
    [isMultiSelectMode]
  );

  const handleCardDragLeave = useCallback((modId: string) => {
    setDragOverModId((prev) => (prev === modId ? null : prev));
  }, []);

  const handleCardDrop = useCallback(
    (modId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverModId(null);
      const sourceId = e.dataTransfer.getData('text/plain') || draggingModId;
      if (sourceId && sourceId !== modId) {
        handleReorder(sourceId, modId);
      }
      setDraggingModId(null);
    },
    [draggingModId, handleReorder]
  );

  const handleCardDragEnd = useCallback(() => {
    setDraggingModId(null);
    setDragOverModId(null);
  }, []);

  const renderModCard = (mod: InstalledMod) => (
    <InstalledModRowCard
      key={mod.id}
      mod={mod}
      collision={collisionByModIdMap.get(mod.id)}
      depStatus={dependencyStatusMap.get(mod.id) || DEFAULT_DEP_STATUS}
      searchText={searchText}
      isMultiSelectMode={isMultiSelectMode}
      isSelected={selectedModIds.has(mod.id)}
      isDragging={draggingModId === mod.id}
      isDragOver={dragOverModId === mod.id && draggingModId !== mod.id}
      onToggleSelect={toggleSelectMod}
      onDragStart={handleCardDragStart}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
      onDragEnd={handleCardDragEnd}
      onMoveStep={handleMoveStep}
      onNavigateConflicts={onNavigateConflicts}
      onToggleMod={onToggleMod}
      onUpdateMod={onUpdateMod}
      onEditConfigs={onEditConfigs}
      onOpenTagModal={setTagModalMod}
      onFilterByTag={setSelectedTagFilter}
      onOpenFolder={onOpenFolder}
      onUninstallMod={onUninstallMod}
    />
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-2">
      {/* Top Action & Telemetry Bar */}
      <InstalledModsStatsBar
        totalInstalledCount={installedMods.length}
        activeCount={activeCount}
        disabledCount={disabledCount}
        updateCount={updateCount}
        modsWithMissingDepsCount={modsWithMissingDepsCount}
        filterMissingOnly={filterMissingOnly}
        onToggleFilterMissing={() => setFilterMissingOnly((prev) => !prev)}
        isMultiSelectMode={isMultiSelectMode}
        selectedCount={selectedModIds.size}
        onToggleMultiSelect={() => {
          setIsMultiSelectMode((prev) => !prev);
          if (isMultiSelectMode) clearSelection();
        }}
        onEnableAll={onEnableAll}
        onDisableAll={onDisableAll}
        onOpenFolder={onOpenFolder}
        onUninstallAll={onUninstallAll}
        onCheckUpdates={onCheckUpdates}
        onOpenBatchUpdate={() => {
          setBatchUpdateMods(installedMods.filter((m) => m.hasUpdate));
          setIsBatchModalOpen(true);
        }}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {/* Bulk Action Controls Bar */}
      {(isMultiSelectMode || selectedModIds.size > 0) && (
        <div className="bg-[#21160F] border border-[#EA580C]/60 rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-xs shadow-md animate-fade-in">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-[#181B20] border border-[#EA580C]/40 px-2.5 py-1 rounded-md">
              <CheckSquare className="w-3.5 h-3.5 text-[#EA580C]" />
              <span className="font-bold text-white">
                {selectedModIds.size} of {displayed.length} selected
              </span>
            </div>

            <button
              onClick={selectAllDisplayed}
              className="bg-[#181B20] hover:bg-[#2A2F38] text-[#E8EAEE] px-2.5 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
              type="button"
              title="Select all currently visible mods"
            >
              Select All ({displayed.length})
            </button>

            {selectedModIds.size > 0 && (
              <button
                onClick={clearSelection}
                className="bg-[#181B20] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-white px-2.5 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
                type="button"
                title="Deselect all mods"
              >
                Deselect All
              </button>
            )}

            <button
              onClick={invertSelection}
              className="bg-[#181B20] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-white px-2.5 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
              type="button"
              title="Invert current selection"
            >
              Invert
            </button>

            <div className="h-4 w-px bg-[#EA580C]/30 mx-1" />

            {selectedModsWithUpdatesCount > 0 && (
              <button
                onClick={() => {
                  const toUpdate = installedMods.filter((m) => selectedModIds.has(m.id) && m.hasUpdate);
                  setBatchUpdateMods(toUpdate);
                  setIsBatchModalOpen(true);
                }}
                className="bg-[#EA580C] hover:bg-[#F97316] text-white px-3 py-1 rounded border border-[#EA580C] flex items-center gap-1.5 font-semibold transition-colors cursor-pointer shadow-xs"
                type="button"
                title="Update selected outdated mods"
              >
                <ArrowUpCircle className="w-3.5 h-3.5 text-white" />
                <span>Update Selected ({selectedModsWithUpdatesCount})</span>
              </button>
            )}

            <button
              disabled={selectedModIds.size === 0}
              onClick={handleApplyBulkEnable}
              className="bg-[#15281B] hover:bg-[#16A34A] text-[#22C55E] hover:text-white disabled:opacity-40 disabled:hover:bg-[#15281B] disabled:hover:text-[#22C55E] px-3 py-1 rounded border border-[#16A34A]/50 flex items-center gap-1.5 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
              type="button"
              title="Enable all selected mods"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Enable ({selectedModIds.size})</span>
            </button>

            <button
              disabled={selectedModIds.size === 0}
              onClick={handleApplyBulkDisable}
              className="bg-[#281515] hover:bg-[#DC2626] text-[#EF4444] hover:text-white disabled:opacity-40 disabled:hover:bg-[#281515] disabled:hover:text-[#EF4444] px-3 py-1 rounded border border-[#DC2626]/50 flex items-center gap-1.5 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
              type="button"
              title="Disable all selected mods"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Disable ({selectedModIds.size})</span>
            </button>

            <button
              disabled={selectedModIds.size === 0}
              onClick={handleApplyBulkUninstall}
              className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white disabled:opacity-40 disabled:hover:bg-[#20252D] disabled:hover:text-[#9AA3AF] px-3 py-1 rounded border border-[#2A2F38] flex items-center gap-1.5 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
              type="button"
              title="Permanently uninstall and delete selected mods"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Uninstall ({selectedModIds.size})</span>
            </button>

            <button
              disabled={selectedModIds.size === 0}
              onClick={() => setIsExportModalOpen(true)}
              className="bg-[#181B20] hover:bg-[#20252D] text-[#EA580C] hover:text-[#F97316] disabled:opacity-40 px-3 py-1 rounded border border-[#EA580C]/40 hover:border-[#EA580C] flex items-center gap-1.5 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
              type="button"
              title="Export selected mods to JSON or CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export ({selectedModIds.size})</span>
            </button>
          </div>

          <button
            onClick={() => {
              setIsMultiSelectMode(false);
              clearSelection();
            }}
            className="bg-[#181B20] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-white px-2.5 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer text-xs"
            type="button"
          >
            Exit Select Mode
          </button>
        </div>
      )}

      {/* Installed Filter Bar */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-[12.5px] shadow-sm">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <InstalledSearchBar
            value={searchText}
            onChange={setSearchText}
            onClear={() => setSearchText('')}
            totalCount={installedMods.length}
            filteredCount={displayed.length}
            placeholder="Search by name, author, or category..."
            className="w-[250px] lg:w-[300px]"
          />

          <button
            onClick={() => {
              setSearchText('');
              setSelectedKind('All');
              setSelectedTagFilter('All');
              setFilterMissingOnly(false);
              setLocalSortField('loadOrder');
              setLocalSortDirection('asc');
              onSortChange?.('loadOrder', 'asc');
              setUpdatesFirst(false);
              setHideDisabled(false);
            }}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
            type="button"
          >
            Clear
          </button>

          {/* Category / Type Filter */}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[#9AA3AF]">Type:</span>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as ModKind | 'All')}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
              title="Filter installed mods by category type: Server, Client, or Both"
            >
              <option value="All">All Types ({installedMods.length})</option>
              <option value="Server">Server ({kindCounts.Server})</option>
              <option value="Client">Client ({kindCounts.Client})</option>
              <option value="Both">Both ({kindCounts.Both})</option>
            </select>
          </div>

          {/* Custom Tag Filter Selector */}
          <div className="flex items-center gap-1.5 ml-1">
            <Tag className="w-3.5 h-3.5 text-[#EA580C]" />
            <span className="text-[#9AA3AF]">Tag:</span>
            <select
              value={selectedTagFilter}
              onChange={(e) => setSelectedTagFilter(e.target.value)}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer max-w-[130px] truncate"
              title="Filter installed mods by custom organization tag"
            >
              <option value="All">All Tags</option>
              {allExistingTags.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  {tag.name} ({tagCountMap.get(tag.name.toLowerCase()) || 0})
                </option>
              ))}
            </select>
          </div>

          {/* Auto-Sort Dropdown Menu */}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[#9AA3AF] flex items-center gap-1 font-semibold text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>Auto-Sort:</span>
            </span>
            <select
              value={sortField}
              onChange={(e) => handleSortFieldChange(e.target.value as InstalledSortField)}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2.5 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer font-medium"
              title="Auto-Sort: Organize installed mods by Category, Installation Date, or Load Order"
            >
              <option value="category">Category (Server → Dual → Client)</option>
              <option value="date-desc">Installation Date (Newest First)</option>
              <option value="date-asc">Installation Date (Oldest First)</option>
              <option value="loadOrder">Load Order (#1 → #N)</option>
              <option value="name">Mod Name (A → Z)</option>
              <option value="status">Status (Active / Disabled)</option>
              <option value="author">Author (A → Z)</option>
            </select>

            <button
              onClick={handleToggleSortDirection}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-2 py-1 rounded border border-[#2A2F38] flex items-center gap-1.5 text-xs cursor-pointer transition-colors"
              title={`Sort direction: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'} (click to reverse)`}
              type="button"
            >
              {sortDirection === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-[#EA580C]" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-[#EA580C]" />
              )}
              <span className="text-[11px] text-[#9AA3AF] font-medium hidden sm:inline">
                {sortField === 'category' && (sortDirection === 'asc' ? 'Server first' : 'Client first')}
                {(sortField === 'date-desc' || sortField === 'date-asc' || sortField === 'date') &&
                  (sortDirection === 'desc' ? 'Newest first' : 'Oldest first')}
                {sortField === 'loadOrder' && (sortDirection === 'asc' ? '#1 First' : '#Last First')}
                {sortField === 'name' && (sortDirection === 'asc' ? 'A→Z' : 'Z→A')}
                {sortField === 'status' && (sortDirection === 'asc' ? 'Enabled first' : 'Disabled first')}
                {sortField === 'author' && (sortDirection === 'asc' ? 'A→Z' : 'Z→A')}
              </span>
            </button>
          </div>

          {/* Auto-Sort Action Menu */}
          <div className="relative ml-1">
            <button
              onClick={() => setShowAutoSortMenu((prev) => !prev)}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#EA580C] hover:text-[#F97316] border border-[#EA580C]/40 hover:border-[#EA580C] px-2.5 py-1 rounded flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
              title="Auto-Sort: Automatically organize mods and assign sequential load orders"
              type="button"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>Auto-Sort</span>
              <ChevronDown className="w-3 h-3 text-[#9AA3AF]" />
            </button>

            {showAutoSortMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowAutoSortMenu(false)} />
                <div className="absolute left-0 mt-1.5 w-72 bg-[#121418] border border-[#23272E] rounded-lg shadow-2xl p-1.5 z-40 space-y-1">
                  <div className="px-2 py-1 text-[11px] font-bold text-[#9AA3AF] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#23272E]/60 mb-1">
                    <Sparkles className="w-3 h-3 text-[#EA580C]" />
                    <span>Auto-Sort Load Order</span>
                  </div>

                  <button
                    onClick={() => handleApplyAutoSort('category')}
                    className="w-full text-left px-2.5 py-2 hover:bg-[#20252D] rounded text-xs flex flex-col gap-0.5 cursor-pointer text-[#E8EAEE] hover:text-white transition-colors"
                    type="button"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[#EA580C]">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Auto-Sort by Category</span>
                    </div>
                    <span className="text-[11px] text-[#9AA3AF]">
                      Server mods (#1) → Dual mods → Client plugins (#N)
                    </span>
                  </button>

                  <button
                    onClick={() => handleApplyAutoSort('date-desc')}
                    className="w-full text-left px-2.5 py-2 hover:bg-[#20252D] rounded text-xs flex flex-col gap-0.5 cursor-pointer text-[#E8EAEE] hover:text-white transition-colors"
                    type="button"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[#22C55E]">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Auto-Sort by Install Date (Newest First)</span>
                    </div>
                    <span className="text-[11px] text-[#9AA3AF]">
                      Places most recently installed mods at the top (#1)
                    </span>
                  </button>

                  <button
                    onClick={() => handleApplyAutoSort('date-asc')}
                    className="w-full text-left px-2.5 py-2 hover:bg-[#20252D] rounded text-xs flex flex-col gap-0.5 cursor-pointer text-[#E8EAEE] hover:text-white transition-colors"
                    type="button"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[#06B6D4]">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Auto-Sort Chronologically (Oldest First)</span>
                    </div>
                    <span className="text-[11px] text-[#9AA3AF]">
                      Orders mods chronologically by initial installation
                    </span>
                  </button>

                  <button
                    onClick={() => handleApplyAutoSort('smart-deps')}
                    className="w-full text-left px-2.5 py-2 hover:bg-[#20252D] rounded text-xs flex flex-col gap-0.5 cursor-pointer text-[#E8EAEE] hover:text-white transition-colors border-t border-[#23272E]/60 pt-1.5"
                    type="button"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-[#F59E0B]">
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Smart Dependency Safe Order</span>
                    </div>
                    <span className="text-[11px] text-[#9AA3AF]">
                      Prerequisites (CommonLib, BigBrain) load before dependents
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Group View Selector */}
          <div className="flex items-center gap-1.5 ml-1">
            <FolderTree className="w-3.5 h-3.5 text-[#EA580C]" />
            <span className="text-[#9AA3AF]">Group:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupByMode)}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
              title="Organize mods into clean collapsible category or timeline groups"
            >
              <option value="none">Flat View (No Groups)</option>
              <option value="category">Category (Server / Client)</option>
              <option value="date">Install Date (Timeline)</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer text-[#9AA3AF] hover:text-[#E8EAEE] ml-1">
            <input
              type="checkbox"
              checked={updatesFirst}
              onChange={(e) => setUpdatesFirst(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Updates first</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-[#9AA3AF] hover:text-[#E8EAEE]">
            <input
              type="checkbox"
              checked={hideDisabled}
              onChange={(e) => setHideDisabled(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Hide Disabled mods</span>
          </label>
        </div>

        <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-[#6B7480]">
          <Layers className="w-3.5 h-3.5 text-[#EA580C]" />
          <span>Drag enabled mods to set load order</span>
        </div>
      </div>

      {/* Installed Mod Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {displayed.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <span className="text-4xl opacity-50 mb-2">📦</span>
            <p className="text-base font-medium text-[#E8EAEE]">No installed mods found</p>
            {searchText.trim() ? (
              <div className="flex flex-col items-center gap-2 mt-1 text-center max-w-md">
                <p className="text-sm">
                  No installed mods found matching{' '}
                  <span className="text-[#EA580C] font-semibold">"{searchText}"</span>. Try searching by name, author, or category.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  className="mt-1 px-3 py-1 bg-[#20252D] hover:bg-[#2A2F38] text-[#EA580C] text-xs font-semibold rounded border border-[#2A2F38] transition-colors cursor-pointer"
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <p className="text-sm">
                {filterMissingOnly
                  ? 'No mods with missing dependencies found. Everything looks good!'
                  : selectedTagFilter !== 'All'
                  ? `No mods found with tag "${selectedTagFilter}".`
                  : 'Install mods from the Browse Mods tab or drop an archive.'}
              </p>
            )}
          </div>
        ) : groupBy === 'category' ? (
          <div className="space-y-4 pb-6">
            {categoryGroups.map((grp) => {
              if (grp.mods.length === 0) return null;
              const isCollapsed = Boolean(collapsedGroups[grp.id]);
              return (
                <div
                  key={grp.id}
                  className="rounded-lg border border-[#23272E] bg-[#121418]/60 overflow-hidden shadow-xs"
                >
                  <div
                    className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#23272E] ${grp.bgColor}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapseGroup(grp.id)}
                      className="flex items-center gap-2.5 cursor-pointer text-left select-none"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-[#9AA3AF]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[#9AA3AF]" />
                      )}
                      <span className="text-base">{grp.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#E8EAEE]">{grp.title}</span>
                          <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#181B20] border border-[#2A2F38] text-[#9AA3AF]">
                            {grp.mods.length} {grp.mods.length === 1 ? 'mod' : 'mods'}
                          </span>
                        </div>
                        <span className="text-[11px] text-[#6B7480]">{grp.subtitle}</span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectGroupMods(grp.mods)}
                        className="text-[11px] font-medium text-[#9AA3AF] hover:text-white bg-[#181B20] hover:bg-[#20252D] px-2.5 py-1 rounded border border-[#2A2F38] cursor-pointer transition-colors"
                        title="Select all mods in this category"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEnableGroupMods(grp.mods)}
                        className="text-[11px] font-medium text-[#22C55E] hover:text-white bg-[#0E2A18] hover:bg-[#16A34A] px-2.5 py-1 rounded border border-[#16A34A]/40 cursor-pointer transition-colors"
                        title="Enable all mods in this category"
                      >
                        Enable All
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDisableGroupMods(grp.mods)}
                        className="text-[11px] font-medium text-[#EF4444] hover:text-white bg-[#2A1015] hover:bg-[#DC2626] px-2.5 py-1 rounded border border-[#EF4444]/40 cursor-pointer transition-colors"
                        title="Disable all mods in this category"
                      >
                        Disable All
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {grp.mods.map(renderModCard)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : groupBy === 'date' ? (
          <div className="space-y-4 pb-6">
            {dateGroups.map((grp) => {
              if (grp.mods.length === 0) return null;
              const isCollapsed = Boolean(collapsedGroups[grp.id]);
              return (
                <div
                  key={grp.id}
                  className="rounded-lg border border-[#23272E] bg-[#121418]/60 overflow-hidden shadow-xs"
                >
                  <div
                    className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#23272E] ${grp.bgColor}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapseGroup(grp.id)}
                      className="flex items-center gap-2.5 cursor-pointer text-left select-none"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-[#9AA3AF]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[#9AA3AF]" />
                      )}
                      <span className="text-base">{grp.icon}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#E8EAEE]">{grp.title}</span>
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#181B20] border border-[#2A2F38] text-[#9AA3AF]">
                          {grp.mods.length} {grp.mods.length === 1 ? 'mod' : 'mods'}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectGroupMods(grp.mods)}
                        className="text-[11px] font-medium text-[#9AA3AF] hover:text-white bg-[#181B20] hover:bg-[#20252D] px-2.5 py-1 rounded border border-[#2A2F38] cursor-pointer transition-colors"
                        title="Select all mods in this time group"
                      >
                        Select All
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {grp.mods.map(renderModCard)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-6">
            {displayed.map(renderModCard)}
          </div>
        )}
      </div>

      {/* Tag Editor Modal */}
      <TagEditorModal
        mod={tagModalMod}
        isOpen={Boolean(tagModalMod)}
        onClose={() => setTagModalMod(null)}
        onSaveTags={(modId, tags) => {
          onUpdateModTags(modId, tags);
          onShowToast('Tags Saved', 'Custom mod tags updated successfully.', 'success');
        }}
        allExistingTags={allExistingTags}
      />

      {/* Export Installed Mods Modal */}
      <ExportModsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        installedMods={installedMods}
        selectedModIds={selectedModIds}
        onShowToast={onShowToast}
      />

      {/* 1-Click Batch Mod Updater Modal */}
      <BatchModUpdateModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        modsToUpdate={batchUpdateMods}
        onExecuteUpdateMod={async (mod) => {
          await onUpdateMod(mod);
        }}
        onShowToast={onShowToast}
        sptVersion={sptVersion}
      />

      {/* Tactical Confirmation Modal */}
      <TacticalConfirmModal {...confirmModalProps} />
    </div>
  );
};
