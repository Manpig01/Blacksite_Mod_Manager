import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Folder,
  Trash2,
  ArrowUpCircle,
  Sliders,
  AlertTriangle,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Layers,
  Tag,
  Plus,
  CheckSquare,
  Check,
  Square,
  Sparkles,
  Calendar,
  FolderTree,
  ChevronRight,
  Download,
} from 'lucide-react';
import { InstalledMod, ConflictInfo, ModKind, ModTag } from '../types';
import { InstalledSearchBar } from './InstalledSearchBar';
import { TagEditorModal } from './TagEditorModal';
import { HighlightText } from './HighlightText';
import { ExportModsModal } from './ExportModsModal';

export type InstalledSortField = 'loadOrder' | 'name' | 'date' | 'date-desc' | 'date-asc' | 'category' | 'status' | 'author';
export type GroupByMode = 'none' | 'category' | 'date';

interface InstalledModsTabProps {
  installedMods: InstalledMod[];
  conflicts: ConflictInfo[];
  onToggleMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onUpdateMod: (mod: InstalledMod) => void;
  onEditConfigs: (mod: InstalledMod) => void;
  onShowConflict: (conflict: ConflictInfo) => void;
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

const getModFolderPaths = (mod: InstalledMod): string[] => {
  const paths: string[] = [];
  const hasServer = mod.kind === 'Server' || mod.kind === 'Both' || Boolean(mod.serverPath);
  const hasClient = mod.kind === 'Client' || mod.kind === 'Both' || Boolean(mod.clientPath);

  if (hasServer) {
    if (mod.serverPath) {
      paths.push(mod.serverPath);
    } else {
      paths.push('SPT_Runtime/user/mods');
    }
  }

  if (hasClient) {
    if (mod.clientPath) {
      const cleanDir = /\.[a-zA-Z0-9]+$/.test(mod.clientPath)
        ? mod.clientPath.replace(/\/[^/]+$/, '')
        : mod.clientPath;
      paths.push(cleanDir || 'BepInEx/plugins');
    } else {
      paths.push('BepInEx/plugins');
    }
  }

  return Array.from(new Set(paths));
};

export const InstalledModsTab: React.FC<InstalledModsTabProps> = ({
  installedMods,
  conflicts,
  onToggleMod,
  onUninstallMod,
  onUpdateMod,
  onEditConfigs,
  onShowConflict,
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

  // Active / disabled counts
  const activeCount = installedMods.filter((m) => !m.isDisabled).length;
  const disabledCount = installedMods.filter((m) => m.isDisabled).length;
  const updateCount = installedMods.filter((m) => m.hasUpdate).length;

  // Compute all unique tags present across installed mods for filtering
  const allExistingTags = useMemo(() => {
    const map = new Map<string, ModTag>();
    installedMods.forEach((m) => {
      m.tags?.forEach((t) => {
        if (!map.has(t.name.toLowerCase())) {
          map.set(t.name.toLowerCase(), t);
        }
      });
    });
    return Array.from(map.values());
  }, [installedMods]);

  // Compute Missing Dependencies Map for all installed mods
  const dependencyStatusMap = useMemo(() => {
    const installedIdMap = new Map<string, InstalledMod>();
    installedMods.forEach((m) => installedIdMap.set(m.id.toLowerCase(), m));

    const statusMap = new Map<
      string,
      {
        hasMissing: boolean;
        missingUninstalled: string[];
        missingDisabled: { id: string; name: string }[];
        allMissing: string[];
      }
    >();

    installedMods.forEach((mod) => {
      const deps = mod.dependencies || [];
      const missingUninstalled: string[] = [];
      const missingDisabled: { id: string; name: string }[] = [];

      deps.forEach((depId) => {
        const found = installedIdMap.get(depId.toLowerCase());
        if (!found) {
          missingUninstalled.push(depId);
        } else if (found.isDisabled) {
          missingDisabled.push({ id: found.id, name: found.name });
        }
      });

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
    });

    return statusMap;
  }, [installedMods]);

  // Count how many installed mods have missing or disabled dependencies
  const modsWithMissingDepsCount = useMemo(() => {
    let count = 0;
    dependencyStatusMap.forEach((status) => {
      if (status.hasMissing) count++;
    });
    return count;
  }, [dependencyStatusMap]);

  // Sort handler - triggers immediate automated organization when category or installation date is picked
  const handleSortFieldChange = (newField: InstalledSortField) => {
    let nextDir: 'asc' | 'desc' = 'asc';
    if (newField === 'date-desc' || newField === 'date') {
      nextDir = 'desc';
    } else {
      nextDir = 'asc';
    }
    setLocalSortField(newField);
    setLocalSortDirection(nextDir);
    if (onSortChange) {
      onSortChange(newField, nextDir);
    }
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
    if (onSortChange) {
      onSortChange(sortField, nextDir);
    }
  };

  const toggleCollapseGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Automated load order reorganization by Category, Install Date, or Dependencies
  const handleApplyAutoSort = (mode: 'category' | 'date-desc' | 'date-asc' | 'smart-deps') => {
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
      if (onSortChange) onSortChange('category', 'asc');
      onShowToast(
        'Auto-Sorted by Category',
        `Reorganized ${sortedEnabled.length} active mods: Server mods first (#1), then Dual mods, then Client plugins.`,
        'success'
      );
    } else if (mode === 'date-desc') {
      sortedEnabled.sort((a, b) => {
        const tA = new Date(a.installDate).getTime() || 0;
        const tB = new Date(b.installDate).getTime() || 0;
        if (tA !== tB) return tB - tA; // Newest first
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      setLocalSortField('date-desc');
      setLocalSortDirection('desc');
      if (onSortChange) onSortChange('date-desc', 'desc');
      onShowToast(
        'Auto-Sorted by Install Date',
        `Reorganized ${sortedEnabled.length} active mods: Newest installations first (#1).`,
        'success'
      );
    } else if (mode === 'date-asc') {
      sortedEnabled.sort((a, b) => {
        const tA = new Date(a.installDate).getTime() || 0;
        const tB = new Date(b.installDate).getTime() || 0;
        if (tA !== tB) return tA - tB; // Oldest first
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      setLocalSortField('date-asc');
      setLocalSortDirection('asc');
      if (onSortChange) onSortChange('date-asc', 'asc');
      onShowToast(
        'Auto-Sorted Chronologically',
        `Reorganized ${sortedEnabled.length} active mods: Oldest installations first (#1).`,
        'success'
      );
    } else if (mode === 'smart-deps') {
      const depTargetFrequency = new Map<string, number>();
      installedMods.forEach((m) => {
        m.dependencies?.forEach((d) => {
          depTargetFrequency.set(d.toLowerCase(), (depTargetFrequency.get(d.toLowerCase()) || 0) + 1);
        });
      });

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
      if (onSortChange) onSortChange('loadOrder', 'asc');
      onShowToast(
        'Smart Dependency Auto-Sort',
        `Assigned optimal load order: Core libraries and prerequisites loaded first.`,
        'success'
      );
    }

    // Re-index sequential load order #1 to #N
    const nextInstalledMods = [
      ...sortedEnabled.map((mod, index) => ({
        ...mod,
        loadOrder: index + 1,
      })),
      ...disabledMods,
    ];

    onReorderMods(nextInstalledMods);
    setShowAutoSortMenu(false);
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

  // Reorder mechanism for enabled mods
  const handleReorder = (draggedId: string, targetId: string) => {
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
    if (onSortChange) onSortChange('loadOrder', 'asc');
    onShowToast(
      'Load Order Updated',
      `Moved "${moved.name}" to position #${targetIdx + 1}.`,
      'success'
    );
  };

  // Move step (one position up or down)
  const handleMoveStep = (modId: string, direction: 'up' | 'down') => {
    const enabledMods = installedMods
      .filter((m) => !m.isDisabled)
      .sort((a, b) => (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999));
    const currentIndex = enabledMods.findIndex((m) => m.id === modId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= enabledMods.length) return;

    handleReorder(modId, enabledMods[targetIndex].id);
  };

  // Tag color badge styling helper
  const getTagBadgeStyle = (color: string) => {
    switch (color) {
      case 'emerald':
        return 'bg-[#0E2A18] text-[#22C55E] border-[#16A34A]/50';
      case 'amber':
        return 'bg-[#3A2A10] text-[#F59E0B] border-[#F59E0B]/50';
      case 'crimson':
        return 'bg-[#2A1015] text-[#EF4444] border-[#EF4444]/50';
      case 'purple':
        return 'bg-[#22102A] text-[#C084FC] border-[#A855F7]/50';
      case 'cyan':
        return 'bg-[#0D2428] text-[#22D3EE] border-[#06B6D4]/50';
      case 'indigo':
        return 'bg-[#181A38] text-[#818CF8] border-[#6366F1]/50';
      case 'pink':
        return 'bg-[#2B1020] text-[#F472B6] border-[#EC4899]/50';
      case 'lime':
        return 'bg-[#1D2B0D] text-[#A3E635] border-[#84CC16]/50';
      case 'slate':
        return 'bg-[#1E232B] text-[#94A3B8] border-[#475569]/50';
      case 'orange':
      default:
        return 'bg-[#3A2415] text-[#F97316] border-[#EA580C]/50';
    }
  };

  // Filter & sort
  let displayed = [...installedMods];

  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();
    displayed = displayed.filter(
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

  // Filter by category type: Server, Client, or Both
  if (selectedKind !== 'All') {
    displayed = displayed.filter((m) => m.kind === selectedKind);
  }

  // Filter by custom Tag
  if (selectedTagFilter !== 'All') {
    displayed = displayed.filter((m) =>
      m.tags?.some((t) => t.name.toLowerCase() === selectedTagFilter.toLowerCase())
    );
  }

  // Filter by missing dependencies only
  if (filterMissingOnly) {
    displayed = displayed.filter((m) => dependencyStatusMap.get(m.id)?.hasMissing);
  }

  if (hideDisabled) {
    displayed = displayed.filter((m) => !m.isDisabled);
  }

  displayed.sort((a, b) => {
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
          const orderA = a.loadOrder ?? 9999;
          const orderB = b.loadOrder ?? 9999;
          comparison = orderA - orderB;
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

  // Multi-Select helpers
  const toggleSelectMod = (modId: string) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) {
        next.delete(modId);
      } else {
        next.add(modId);
      }
      return next;
    });
  };

  const selectAllDisplayed = () => {
    setSelectedModIds(new Set(displayed.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelectedModIds(new Set());
  };

  const invertSelection = () => {
    setSelectedModIds((prev) => {
      const next = new Set<string>();
      displayed.forEach((m) => {
        if (!prev.has(m.id)) {
          next.add(m.id);
        }
      });
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

  const handleApplyBulkUninstall = () => {
    const ids = Array.from(selectedModIds);
    if (ids.length === 0) return;
    if (onBulkUninstall) {
      onBulkUninstall(ids);
    } else {
      if (confirm(`Permanently uninstall ${ids.length} selected mods and delete their files?`)) {
        ids.forEach((id) => onUninstallMod(id));
        onShowToast('Bulk Uninstall', `Uninstalled ${ids.length} mods.`, 'warning');
      }
    }
    clearSelection();
  };

  const categoryGroups = useMemo(() => [
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
  ], [displayed]);

  const dateGroups = useMemo(() => {
    const now = Date.now();
    const recent: InstalledMod[] = [];
    const earlier: InstalledMod[] = [];
    const older: InstalledMod[] = [];

    displayed.forEach((m) => {
      const t = new Date(m.installDate).getTime();
      if (!t) {
        older.push(m);
        return;
      }
      const days = Math.floor((now - t) / (1000 * 60 * 60 * 24));
      if (days <= 7) recent.push(m);
      else if (days <= 30) earlier.push(m);
      else older.push(m);
    });

    return [
      { id: 'date-recent', title: 'Recent Installations (Last 7 Days)', icon: '🔥', mods: recent, bgColor: 'bg-[#3A2415]/40' },
      { id: 'date-earlier', title: 'Earlier This Month', icon: '📅', mods: earlier, bgColor: 'bg-[#182038]/40' },
      { id: 'date-older', title: 'Older Installations', icon: '📦', mods: older, bgColor: 'bg-[#1E232B]/40' },
    ];
  }, [displayed]);

  const renderModCard = (mod: InstalledMod) => {
    const conflict = conflicts.find((c) => c.conflictingModIds.includes(mod.id));
    const hasThumbnail = Boolean(mod.thumbnail);
    const isDragging = draggingModId === mod.id;
    const isDragOver = dragOverModId === mod.id && !isDragging;
    const isSelected = selectedModIds.has(mod.id);

    // Missing dependency status
    const depStatus = dependencyStatusMap.get(mod.id) || {
      hasMissing: false,
      missingUninstalled: [],
      missingDisabled: [],
      allMissing: [],
    };
    const hasMissingDeps = depStatus.hasMissing;

    return (
      <div
        key={mod.id}
        draggable={!mod.isDisabled && !isMultiSelectMode}
        onDragStart={(e) => {
          if (mod.isDisabled || isMultiSelectMode) return;
          setDraggingModId(mod.id);
          e.dataTransfer.setData('text/plain', mod.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (mod.isDisabled || isMultiSelectMode) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverModId !== mod.id) {
            setDragOverModId(mod.id);
          }
        }}
        onDragLeave={() => {
          if (dragOverModId === mod.id) {
            setDragOverModId(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverModId(null);
          const sourceId = e.dataTransfer.getData('text/plain') || draggingModId;
          if (sourceId && sourceId !== mod.id && !mod.isDisabled) {
            handleReorder(sourceId, mod.id);
          }
          setDraggingModId(null);
        }}
        onDragEnd={() => {
          setDraggingModId(null);
          setDragOverModId(null);
        }}
        onClick={() => {
          if (isMultiSelectMode) {
            toggleSelectMod(mod.id);
          }
        }}
        className={`min-h-[245px] rounded-lg p-2.5 transition-all flex gap-2 relative border ${
          isSelected
            ? 'ring-2 ring-[#EA580C] bg-[#EA580C]/10 border-[#EA580C] shadow-lg'
            : isDragging
            ? 'opacity-40 border-dashed border-[#EA580C] scale-[0.98]'
            : isDragOver
            ? 'ring-2 ring-[#EA580C] bg-[#EA580C]/10 border-[#EA580C] shadow-lg scale-[1.01]'
            : hasMissingDeps
            ? 'bg-[#1C0D0F] border-2 border-[#DC2626] shadow-[0_0_16px_rgba(220,38,38,0.28)] ring-1 ring-[#DC2626]/50'
            : mod.isDisabled
            ? 'bg-[#14161A] border-[#20252D] opacity-75'
            : 'bg-[#181B20] border-[#23272E] hover:border-[#EA580C]'
        }`}
      >
        {/* Multi-Select Checkbox Overlay */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            toggleSelectMod(mod.id);
            if (!isMultiSelectMode) {
              setIsMultiSelectMode(true);
            }
          }}
          className={`absolute top-2 right-2 z-20 cursor-pointer p-0.5 rounded transition-transform ${
            isMultiSelectMode || isSelected
              ? 'opacity-100 scale-100'
              : 'opacity-0 hover:opacity-100 scale-95 hover:scale-100'
          }`}
          title={isSelected ? 'Deselect mod' : 'Select mod for bulk actions'}
        >
          <div
            className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
              isSelected
                ? 'bg-[#EA580C] border-[#EA580C] text-white shadow-md ring-2 ring-[#EA580C]/40'
                : 'bg-[#0E1013]/90 border-[#3A4150] hover:border-[#EA580C] text-transparent'
            }`}
          >
            <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100 stroke-[3]' : 'opacity-0'}`} />
          </div>
        </div>

        {/* Far-Left Drag Handle & Step Controls */}
        <div
          className={`w-6 flex flex-col items-center justify-between py-1 px-0.5 rounded shrink-0 select-none ${
            mod.isDisabled || isMultiSelectMode
              ? 'opacity-25 cursor-not-allowed'
              : 'cursor-grab active:cursor-grabbing hover:bg-[#20252D] text-[#9AA3AF] hover:text-[#EA580C]'
          }`}
          title={
            isMultiSelectMode
              ? 'Drag reorder is disabled in multi-select mode'
              : mod.isDisabled
              ? 'Disabled mods cannot be reordered'
              : `Drag to reorder (Load Order #${mod.loadOrder ?? '?'})`
          }
        >
          <button
            type="button"
            disabled={mod.isDisabled || isMultiSelectMode}
            onClick={(e) => {
              e.stopPropagation();
              handleMoveStep(mod.id, 'up');
            }}
            className="p-0.5 text-[#6B7480] hover:text-[#EA580C] disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed rounded"
            title="Move up in load order"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>

          <GripVertical className="w-3.5 h-3.5 text-[#9AA3AF] hover:text-[#EA580C] my-auto" />

          <button
            type="button"
            disabled={mod.isDisabled || isMultiSelectMode}
            onClick={(e) => {
              e.stopPropagation();
              handleMoveStep(mod.id, 'down');
            }}
            className="p-0.5 text-[#6B7480] hover:text-[#EA580C] disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed rounded"
            title="Move down in load order"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Thumbnail column (125x125) */}
        <div className="w-[125px] h-[125px] shrink-0 relative bg-[#20252D] rounded-md overflow-hidden self-center border border-[#23272E]">
          {hasThumbnail ? (
            <img
              src={mod.thumbnail}
              alt={mod.name}
              className={`w-full h-full object-cover ${mod.isDisabled ? 'grayscale' : ''}`}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : null}

          {/* Placeholder initial */}
          <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-[#3A4150] -z-10 select-none">
            {mod.name.charAt(0).toUpperCase()}
          </div>

          {/* Top-left: green SPT version badge */}
          <div className="absolute top-1 left-1 bg-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-white tracking-tight shadow">
            SPT {mod.sptVersion || '4.x'}
          </div>

          {/* Missing Dependency Badge */}
          {hasMissingDeps && (
            <div
              className="absolute bottom-1 right-1 bg-[#DC2626] border border-white/30 text-white rounded px-1.5 py-0.5 text-[9px] font-extrabold flex items-center gap-0.5 shadow-md animate-pulse"
              title={`Missing dependencies: ${depStatus.allMissing.join(', ')}`}
            >
              <AlertCircle className="w-2.5 h-2.5" />
              <span>MISSING DEP</span>
            </div>
          )}

          {/* Top-right: Conflict Warning Badge */}
          {conflict && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowConflict(conflict);
              }}
              className="absolute top-1 right-1 bg-[#3A2A10] border border-[#F59E0B] text-[#F59E0B] rounded px-1.5 py-0.5 text-[9.5px] font-bold flex items-center gap-0.5 cursor-pointer shadow hover:bg-[#4A3515] transition-colors z-10"
              title={conflict.details}
              type="button"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              <span>CONFLICT</span>
            </button>
          )}

          {/* Bottom-left: Fika Compatible overlay */}
          {mod.fikaCompatibility && !hasMissingDeps && (
            <div className="absolute bottom-1 left-1 bg-[#0E2A18] border border-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-[#22C55E] tracking-tight shadow">
              Fika Compatible
            </div>
          )}
        </div>

        {/* Content area right */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0">
          <div>
            {/* Load Order Badge + Title */}
            <div className="flex items-center gap-1.5 pr-6">
              {!mod.isDisabled && typeof mod.loadOrder === 'number' ? (
                <span
                  className="bg-[#EA580C]/15 border border-[#EA580C]/40 text-[#F97316] text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 shadow-2xs flex items-center gap-0.5"
                  title={`SPT Execution Load Order #${mod.loadOrder}`}
                >
                  <Layers className="w-2.5 h-2.5" />
                  #{mod.loadOrder}
                </span>
              ) : (
                <span
                  className="bg-[#20252D] text-[#6B7480] text-[9.5px] font-mono px-1 py-0.2 rounded shrink-0"
                  title="Disabled mod (no active load order)"
                >
                  Inactive
                </span>
              )}

              <h3
                className={`text-[13.5px] font-bold truncate tracking-tight ${
                  hasMissingDeps ? 'text-[#EF4444]' : 'text-[#E8EAEE]'
                }`}
                title={mod.name}
              >
                <HighlightText text={mod.name} query={searchText} />
              </h3>
            </div>

            {/* Package ID */}
            <p
              className="font-mono text-[10.5px] text-[#6B7480] truncate mt-0.5"
              title={mod.id}
            >
              <HighlightText text={mod.id} query={searchText} />
            </p>

            {/* Missing Dependencies Alert Banner (Red Highlighting) */}
            {hasMissingDeps && (
              <div className="mt-1 bg-[#281013] border border-[#DC2626] rounded px-2 py-1 text-[11px] text-[#EF4444] shadow-xs">
                <div className="flex items-center gap-1 font-bold">
                  <AlertCircle className="w-3 h-3 text-[#EF4444] shrink-0" />
                  <span>Missing Required Dependencies:</span>
                </div>
                <div className="mt-0.5 space-y-0.5 pl-4 text-[10.5px]">
                  {depStatus.missingUninstalled.map((missingId) => (
                    <div key={missingId} className="text-[#FCA5A5] font-mono truncate">
                      • <HighlightText text={missingId} query={searchText} />{' '}
                      <span className="text-[#EF4444] font-sans font-semibold">(Not Installed)</span>
                    </div>
                  ))}
                  {depStatus.missingDisabled.map((dis) => (
                    <div key={dis.id} className="text-[#FCA5A5] font-mono truncate flex items-center gap-1">
                      • <HighlightText text={dis.name} query={searchText} />{' '}
                      <span className="text-[#F59E0B] font-sans font-semibold">(Disabled)</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMod(dis.id);
                        }}
                        className="ml-1 text-[9.5px] bg-[#3A2A10] hover:bg-[#F59E0B] text-[#F59E0B] hover:text-black font-sans px-1.5 py-0.2 rounded border border-[#F59E0B]/50 transition-colors cursor-pointer"
                        title={`Enable prerequisite ${dis.name}`}
                      >
                        Enable Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Author + Category + Mod Kind */}
            <div className="flex items-center gap-1 mt-1 text-[11px] flex-wrap">
              <span className="bg-[#20252D] text-[#EA580C] px-1.5 py-0.2 rounded font-semibold text-[10.5px]">
                <HighlightText text={mod.author} query={searchText} />
              </span>

              {mod.categoryTitle && (
                <span className="bg-[#181B20] border border-[#2A2F38] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded font-medium">
                  <HighlightText text={mod.categoryTitle} query={searchText} />
                </span>
              )}

              {mod.kind === 'Server' && (
                <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                  <HighlightText text="Server" query={searchText} />
                </span>
              )}
              {mod.kind === 'Client' && (
                <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                  <HighlightText text="Client Plugin" query={searchText} />
                </span>
              )}
              {mod.kind === 'Both' && (
                <>
                  <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                    <HighlightText text="Server" query={searchText} />
                  </span>
                  <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                    <HighlightText text="Client" query={searchText} />
                  </span>
                </>
              )}
            </div>

            {/* Custom Tags Row */}
            <div className="flex items-center gap-1 mt-1.5 overflow-hidden flex-wrap max-h-6">
              {mod.tags && mod.tags.length > 0 ? (
                mod.tags.map((t) => (
                  <span
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTagFilter(t.name);
                    }}
                    className={`text-[9.5px] font-semibold px-1.5 py-0.2 rounded-md border flex items-center gap-1 cursor-pointer transition-transform hover:scale-105 ${getTagBadgeStyle(
                      t.color
                    )}`}
                    title={`Filter by tag "${t.name}"`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
                    <span>
                      <HighlightText text={t.name} query={searchText} />
                    </span>
                  </span>
                ))
              ) : null}

              {/* Inline Tag button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTagModalMod(mod);
                }}
                className="text-[9.5px] text-[#6B7480] hover:text-[#E8EAEE] hover:bg-[#20252D] px-1 py-0.2 rounded border border-transparent hover:border-[#2A2F38] flex items-center gap-0.5 cursor-pointer transition-colors"
                title="Manage custom tags for this mod"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>Tag</span>
              </button>
            </div>

            {/* Version & path stats */}
            <div className="text-[11px] text-[#9AA3AF] mt-1 truncate">
              <span>v{mod.version}</span>
              {mod.serverPath && (
                <span className="text-[#6B7480] ml-1.5">
                  · <HighlightText text={mod.serverPath.split('/').pop() || ''} query={searchText} />
                </span>
              )}
              {mod.clientPath && !mod.serverPath && (
                <span className="text-[#6B7480] ml-1.5">
                  · <HighlightText text={mod.clientPath.split('/').pop() || ''} query={searchText} />
                </span>
              )}
            </div>

            {/* Update Notice */}
            {mod.hasUpdate && (
              <div className="flex items-center gap-1 text-[11px] text-[#EA580C] font-semibold mt-1">
                <ArrowUpCircle className="w-3 h-3" />
                <span>Update available: v{mod.latestVersion}</span>
              </div>
            )}
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2 border-t border-[#23272E] mt-2">
            {/* Enable/Disable Toggle button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMod(mod.id);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                mod.isDisabled
                  ? 'bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE]'
                  : 'bg-[#15281B] hover:bg-[#1C3624] text-[#22C55E]'
              }`}
              title={mod.isDisabled ? 'Click to enable mod' : 'Click to disable mod (.disabled suffix)'}
              type="button"
            >
              <span
                className={`w-2 h-2 rounded-full ${mod.isDisabled ? 'bg-[#9AA3AF]' : 'bg-[#22C55E]'}`}
              />
              <span>{mod.isDisabled ? 'Disabled' : 'Enabled'}</span>
            </button>

            {/* Right action icons */}
            <div className="flex items-center gap-1">
              {/* Update Button */}
              {mod.hasUpdate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateMod(mod);
                  }}
                  className="bg-[#EA580C] hover:bg-[#F97316] text-white p-1.5 rounded transition-colors cursor-pointer"
                  title={`Update to v${mod.latestVersion}`}
                  type="button"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Tag button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTagModalMod(mod);
                }}
                className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded transition-colors cursor-pointer"
                title="Manage tags"
                type="button"
              >
                <Tag className="w-3.5 h-3.5" />
              </button>

              {/* Config Files button */}
              {mod.configFiles && mod.configFiles.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditConfigs(mod);
                  }}
                  className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded transition-colors cursor-pointer"
                  title={`Edit mod configuration (${mod.configFiles.length} file${mod.configFiles.length > 1 ? 's' : ''})`}
                  type="button"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Open Mod Directory in Explorer */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const paths = getModFolderPaths(mod);
                  if (paths.length > 1) {
                    onOpenFolder(paths);
                  } else {
                    onOpenFolder(paths[0] || 'BepInEx/plugins');
                  }
                }}
                className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded transition-colors cursor-pointer"
                title={
                  mod.kind === 'Both' || (Boolean(mod.serverPath) && Boolean(mod.clientPath))
                    ? 'Open both BepInEx and SPT_Runtime/user/mods folders in File Explorer'
                    : 'Open mod files directory in File Explorer'
                }
                type="button"
              >
                <Folder className="w-3.5 h-3.5" />
              </button>

              {/* Uninstall */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUninstallMod(mod.id);
                }}
                className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white p-1.5 rounded transition-colors cursor-pointer"
                title="Uninstall and delete mod files"
                type="button"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-2">
      {/* Top Action Bar */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-[12.5px] shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Multi-Select Mode Toggle Button */}
          <button
            onClick={() => {
              setIsMultiSelectMode((prev) => !prev);
              if (isMultiSelectMode) clearSelection();
            }}
            className={`px-3 py-1.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-semibold ${
              isMultiSelectMode || selectedModIds.size > 0
                ? 'bg-[#EA580C] text-white border-[#EA580C] shadow-sm'
                : 'bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] border-[#2A2F38]'
            }`}
            title="Toggle multi-select mode to enable, disable, or uninstall multiple mods at once"
            type="button"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{isMultiSelectMode ? 'Exit Select Mode' : 'Multi-Select'}</span>
            {selectedModIds.size > 0 && (
              <span className="bg-black/30 text-white font-mono px-1.5 py-0.2 rounded-full text-[10.5px]">
                {selectedModIds.size}
              </span>
            )}
          </button>

          <div className="h-4 w-px bg-[#2A2F38] mx-0.5" />

          <button
            onClick={onEnableAll}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Enable all installed mods"
            type="button"
          >
            <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />
            <span>Enable All</span>
          </button>

          <button
            onClick={onDisableAll}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Disable all installed mods"
            type="button"
          >
            <XCircle className="w-3.5 h-3.5 text-[#DC2626]" />
            <span>Disable All</span>
          </button>

          <div className="h-4 w-px bg-[#2A2F38] mx-0.5" />

          <button
            onClick={() => onOpenFolder('client')}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Open client plugins folder (BepInEx/plugins)"
            type="button"
          >
            <Folder className="w-3.5 h-3.5 text-[#9AA3AF]" />
            <span>Plugins Folder</span>
          </button>

          <button
            onClick={() => onOpenFolder('server')}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Open server mods folder (SPT_Runtime/user/mods)"
            type="button"
          >
            <Folder className="w-3.5 h-3.5 text-[#9AA3AF]" />
            <span>Server Folder</span>
          </button>

          <button
            onClick={onUninstallAll}
            className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Permanently remove all installed mods"
            type="button"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Uninstall All</span>
          </button>

          <button
            onClick={onCheckUpdates}
            className="bg-[#EA580C] hover:bg-[#F97316] text-white px-3.5 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            title="Send installed package IDs + versions to sp-mod.com update check"
            type="button"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>Check for Updates</span>
          </button>

          {/* Export Installed Mods Manifest (JSON / CSV) */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] hover:text-[#EA580C] px-3.5 py-1.5 rounded-md border border-[#2A2F38] hover:border-[#EA580C]/40 flex items-center gap-1.5 font-medium transition-colors cursor-pointer shadow-xs"
            title="Export installed mods list as JSON manifest or CSV spreadsheet"
            type="button"
          >
            <Download className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>
              {selectedModIds.size > 0 ? `Export (${selectedModIds.size})` : 'Export List'}
            </span>
          </button>

          {/* Missing Dependencies Warning Button / Filter */}
          {modsWithMissingDepsCount > 0 && (
            <button
              onClick={() => setFilterMissingOnly((prev) => !prev)}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-semibold text-xs border transition-all cursor-pointer shadow-xs ${
                filterMissingOnly
                  ? 'bg-[#DC2626] text-white border-[#DC2626] shadow-[0_0_10px_rgba(220,38,38,0.5)]'
                  : 'bg-[#281013] text-[#EF4444] border-[#DC2626]/50 hover:bg-[#38161A]'
              }`}
              title="Click to toggle filtering mods with missing or disabled dependencies"
              type="button"
            >
              <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] animate-pulse" />
              <span>{modsWithMissingDepsCount} Missing Dependencies</span>
            </button>
          )}
        </div>

        <div className="text-[12px] text-[#9AA3AF] font-medium ml-auto flex items-center gap-2">
          <span>
            {installedMods.length} installed ({activeCount} active, {disabledCount} disabled
            {updateCount > 0 && (
              <span className="text-[#EA580C] font-semibold ml-1.5">
                · {updateCount} update available
              </span>
            )}
            )
          </span>
        </div>
      </div>

      {/* Bulk Action Controls Bar (Appears when in multi-select mode or any mod is selected) */}
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

            {/* Bulk Action Buttons */}
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
          {/* Real-time Search Bar Component */}
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
              if (onSortChange) onSortChange('loadOrder', 'asc');
              setUpdatesFirst(false);
              setHideDisabled(false);
            }}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
            type="button"
          >
            Clear
          </button>

          {/* Category / Type Filter (Server, Client, Both) */}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[#9AA3AF]">Type:</span>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as ModKind | 'All')}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
              title="Filter installed mods by category type: Server, Client, or Both"
            >
              <option value="All">All Types ({installedMods.length})</option>
              <option value="Server">
                Server ({installedMods.filter((m) => m.kind === 'Server').length})
              </option>
              <option value="Client">
                Client ({installedMods.filter((m) => m.kind === 'Client').length})
              </option>
              <option value="Both">
                Both ({installedMods.filter((m) => m.kind === 'Both').length})
              </option>
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
                  {tag.name} (
                  {
                    installedMods.filter((m) =>
                      m.tags?.some((t) => t.name.toLowerCase() === tag.name.toLowerCase())
                    ).length
                  }
                  )
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
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowAutoSortMenu(false)}
                />
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

        {/* Drag-and-drop tip */}
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
                  No installed mods found matching <span className="text-[#EA580C] font-semibold">"{searchText}"</span>. Try searching by name, author, or category.
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
                <div key={grp.id} className="rounded-lg border border-[#23272E] bg-[#121418]/60 overflow-hidden shadow-xs">
                  {/* Category Header */}
                  <div className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#23272E] ${grp.bgColor}`}>
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
                <div key={grp.id} className="rounded-lg border border-[#23272E] bg-[#121418]/60 overflow-hidden shadow-xs">
                  <div className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#23272E] ${grp.bgColor}`}>
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

      {/* Export Installed Mods Modal (JSON / CSV) */}
      <ExportModsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        installedMods={installedMods}
        selectedModIds={selectedModIds}
        onShowToast={onShowToast}
      />
    </div>
  );
};
