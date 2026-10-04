import React, { useState, useMemo } from 'react';
import {
  Boxes,
  Camera,
  Download,
  Upload,
  Share2,
  RotateCcw,
  Check,
  Copy,
  Trash2,
  AlertTriangle,
  Clock,
  Search,
  X,
  FileText,
  ShieldAlert,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { InstalledMod, ModpackSnapshot, LoadoutManifest } from '../types';
import { storageService } from '../services/storageService';

interface ModpacksTabProps {
  installedMods: InstalledMod[];
  sptVersion: string;
  onApplyLoadout: (
    modsToEnable: string[],
    modsToDisable: string[],
    loadOrders?: Record<string, number>,
    missingMods?: string[]
  ) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
  onNavigateToBrowse?: (searchQuery?: string) => void;
}

export const ModpacksTab: React.FC<ModpacksTabProps> = ({
  installedMods,
  sptVersion,
  onApplyLoadout,
  onShowToast,
  onNavigateToBrowse,
}) => {
  // Snapshot state
  const [snapshots, setSnapshots] = useState<ModpackSnapshot[]>(() =>
    storageService.loadSnapshots()
  );

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotNotes, setSnapshotNotes] = useState('');

  const [showImportModal, setShowImportModal] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [parsedManifest, setParsedManifest] = useState<LoadoutManifest | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showExportModal, setShowExportModal] = useState(false);
  const [copiedShareCode, setCopiedShareCode] = useState(false);

  // Quick lookup for installed mods
  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledMod>();
    installedMods.forEach((m) => {
      map.set(m.id.toLowerCase(), m);
    });
    return map;
  }, [installedMods]);

  // Current active manifest
  const currentManifest = useMemo<LoadoutManifest>(() => {
    return {
      name: `Blacksite Loadout (${new Date().toLocaleDateString()})`,
      sptVersion,
      exportedAt: new Date().toISOString(),
      mods: installedMods.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        enabled: !m.isDisabled,
        loadOrder: m.loadOrder,
        kind: m.kind,
      })),
    };
  }, [installedMods, sptVersion]);

  // Share code for current setup
  const currentShareCode = useMemo(() => {
    return storageService.generateShareCode(currentManifest);
  }, [currentManifest]);

  // Handle Taking Snapshot
  const handleCreateSnapshot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!snapshotName.trim()) {
      onShowToast('Missing Name', 'Please enter a name for your snapshot checkpoint.', 'warning');
      return;
    }

    const created = storageService.createSnapshot(
      snapshotName,
      snapshotNotes,
      sptVersion,
      installedMods
    );

    setSnapshots(storageService.loadSnapshots());
    setShowSnapshotModal(false);
    setSnapshotName('');
    setSnapshotNotes('');
    onShowToast(
      'Snapshot Saved',
      `Checkpoint "${created.name}" created with ${created.enabledModIds.length} active mods.`,
      'success'
    );
  };

  // Handle Deleting Snapshot
  const handleDeleteSnapshot = (id: string, name: string) => {
    if (confirm(`Delete snapshot checkpoint "${name}"? This action cannot be undone.`)) {
      storageService.deleteSnapshot(id);
      setSnapshots(storageService.loadSnapshots());
      onShowToast('Snapshot Deleted', `Checkpoint "${name}" was removed.`, 'info');
    }
  };

  // Handle Restoring Snapshot
  const handleRestoreSnapshot = (snapshot: ModpackSnapshot) => {
    const enabledSet = new Set(snapshot.enabledModIds.map((id) => id.toLowerCase()));
    const toEnable: string[] = [];
    const toDisable: string[] = [];
    const loadOrders: Record<string, number> = {};

    snapshot.modSnapshots.forEach((snap) => {
      const isInstalled = installedMap.has(snap.id.toLowerCase());
      if (isInstalled) {
        if (!snap.isDisabled) {
          toEnable.push(snap.id);
        } else {
          toDisable.push(snap.id);
        }
        if (typeof snap.loadOrder === 'number') {
          loadOrders[snap.id] = snap.loadOrder;
        }
      }
    });

    // Also disable any currently installed mods that were NOT in the snapshot
    installedMods.forEach((m) => {
      if (!enabledSet.has(m.id.toLowerCase()) && !toDisable.includes(m.id)) {
        toDisable.push(m.id);
      }
    });

    onApplyLoadout(toEnable, toDisable, loadOrders);
    onShowToast(
      'Checkpoint Restored',
      `Restored state from "${snapshot.name}" (${toEnable.length} active mods).`,
      'success'
    );
  };

  // Parse import input on change
  const handleImportInputChange = (text: string) => {
    setImportInput(text);
    setImportError(null);

    if (!text.trim()) {
      setParsedManifest(null);
      return;
    }

    const manifest = storageService.parseShareCode(text);
    if (manifest) {
      setParsedManifest(manifest);
    } else {
      setParsedManifest(null);
      setImportError('Invalid share code or JSON format. Ensure code begins with "BS-" or valid JSON.');
    }
  };

  // Handle Drag & Drop file import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleImportInputChange(content);
    };
    reader.readAsText(file);
  };

  // Handle applying parsed manifest from import modal
  const handleApplyImportedManifest = () => {
    if (!parsedManifest) return;

    const toEnable: string[] = [];
    const toDisable: string[] = [];
    const loadOrders: Record<string, number> = {};
    const missing: string[] = [];

    parsedManifest.mods.forEach((item) => {
      const match = installedMap.get(item.id.toLowerCase());
      if (match) {
        if (item.enabled) {
          toEnable.push(match.id);
        } else {
          toDisable.push(match.id);
        }
        if (typeof item.loadOrder === 'number') {
          loadOrders[match.id] = item.loadOrder;
        }
      } else if (item.enabled) {
        missing.push(item.id);
      }
    });

    onApplyLoadout(toEnable, toDisable, loadOrders, missing);
    setShowImportModal(false);
    setImportInput('');
    setParsedManifest(null);

    onShowToast(
      'Loadout Applied',
      `Applied loadout "${parsedManifest.name}". ${toEnable.length} enabled, ${toDisable.length} disabled.${
        missing.length > 0 ? ` ${missing.length} mods need installation.` : ''
      }`,
      missing.length > 0 ? 'warning' : 'success'
    );
  };

  // Download manifest as .json
  const handleDownloadManifest = (manifest: LoadoutManifest) => {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacksite-loadout-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Export Complete', 'Loadout manifest JSON saved to your downloads.', 'success');
  };

  // Filtered Snapshots
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      const q = searchQuery.trim().toLowerCase();
      return (
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q))
      );
    });
  }, [snapshots, searchQuery]);

  const activeCount = useMemo(
    () => installedMods.filter((m) => !m.isDisabled).length,
    [installedMods]
  );

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto bg-[#121418] text-[#E8EAEE]">
      {/* Top Banner / Hero */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4.5 mb-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[#EA580C]/10 text-[#EA580C] border border-[#EA580C]/30">
              <Boxes className="w-5 h-5" />
            </span>
            <h1 className="text-lg font-bold tracking-tight text-[#E8EAEE]">
              Modpack Tools: Checkpoints & Sharing
            </h1>
            <span className="text-[11px] font-mono bg-[#20252D] text-[#9AA3AF] px-2 py-0.5 rounded">
              SPT {sptVersion}
            </span>
          </div>
          <p className="text-xs text-[#9AA3AF] mt-1 max-w-2xl">
            Save non-destructive system checkpoints for instant rollback, share compressed loadout
            codes with squadmates, or import configuration manifests.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowSnapshotModal(true)}
            className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            type="button"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Take Checkpoint</span>
          </button>

          <button
            onClick={() => {
              setShowImportModal(true);
              setImportInput('');
              setParsedManifest(null);
            }}
            className="bg-[#20252D] hover:bg-[#2A2F38] border border-[#2B303C] text-[#E8EAEE] text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            type="button"
          >
            <Upload className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>Import Loadout</span>
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="bg-[#20252D] hover:bg-[#2A2F38] border border-[#2B303C] text-[#E8EAEE] text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            type="button"
          >
            <Share2 className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Share Active</span>
          </button>
        </div>
      </div>

      {/* Active Loadout Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-[#9AA3AF] font-medium block">Active Loadout</span>
            <span className="text-xl font-bold font-mono text-[#22C55E]">
              {activeCount}{' '}
              <span className="text-xs font-normal text-[#9AA3AF]">
                / {installedMods.length} mods enabled
              </span>
            </span>
          </div>
          <Layers className="w-6 h-6 text-[#22C55E]/60" />
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-[#9AA3AF] font-medium block">Saved Checkpoints</span>
            <span className="text-xl font-bold font-mono text-[#38BDF8]">
              {snapshots.length}{' '}
              <span className="text-xs font-normal text-[#9AA3AF]">available</span>
            </span>
          </div>
          <Clock className="w-6 h-6 text-[#38BDF8]/60" />
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-3.5 flex items-center justify-between">
          <div className="truncate mr-2">
            <span className="text-[11px] text-[#9AA3AF] font-medium block">Quick Share Code</span>
            <span className="text-xs font-mono text-[#E8EAEE] truncate block">
              {currentShareCode.slice(0, 24)}...
            </span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(currentShareCode);
              onShowToast('Copied', 'Share code copied to clipboard.', 'success');
            }}
            className="p-2 rounded-lg bg-[#20252D] hover:bg-[#2A2F38] text-[#EA580C] border border-[#2A2F38] transition-colors cursor-pointer shrink-0"
            title="Copy share code to clipboard"
            type="button"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-4 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="font-semibold text-[#E8EAEE]">Saved Checkpoints Timeline</span>
          <span className="text-[11px] font-mono text-[#9AA3AF]">
            ({filteredSnapshots.length} checkpoints)
          </span>
        </div>

        {/* Search */}
        <div className="relative flex items-center w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter checkpoints..."
            className="w-full bg-[#0E1013] border border-[#23272E] rounded-md pl-8 pr-7 py-1 text-xs text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9AA3AF] hover:text-white"
              type="button"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Saved Checkpoints List */}
      <div className="flex-1">
        {filteredSnapshots.length === 0 ? (
          <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-8 text-center flex flex-col items-center justify-center text-[#9AA3AF]">
            <Camera className="w-8 h-8 text-[#6B7480] mb-2 opacity-50" />
            <p className="text-sm font-medium text-[#E8EAEE]">No saved checkpoints found</p>
            <p className="text-xs mt-1 max-w-md">
              Take a snapshot before tweaking configuration or modifying your mod list to
              safeguard your working setup.
            </p>
            <button
              onClick={() => setShowSnapshotModal(true)}
              className="mt-3 bg-[#20252D] hover:bg-[#2A2F38] text-[#EA580C] text-xs font-semibold px-3 py-1.5 rounded-md border border-[#2A2F38] cursor-pointer transition-colors"
              type="button"
            >
              Create Checkpoint
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredSnapshots.map((snap) => {
              const dateFormatted = new Date(snap.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={snap.id}
                  className="bg-[#181B20] border border-[#23272E] hover:border-[#2B303C] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[#20252D] text-[#38BDF8] shrink-0 mt-0.5">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[#E8EAEE] tracking-tight">
                          {snap.name}
                        </h3>
                        <span className="text-[10px] font-mono text-[#9AA3AF] bg-[#0E1013] px-1.5 py-0.2 rounded border border-[#23272E]">
                          SPT {snap.sptVersion}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-[#9AA3AF] mt-0.5">
                        <span>{dateFormatted}</span>
                        <span>·</span>
                        <span className="font-mono text-[#22C55E]">
                          {snap.enabledModIds.length} active mods
                        </span>
                        <span>·</span>
                        <span className="text-[#6B7480]">
                          {snap.totalModsCount} registered
                        </span>
                      </div>

                      {snap.notes && (
                        <p className="text-xs text-[#9AA3AF] mt-1 bg-[#121418] px-2 py-1 rounded border border-[#23272E]/60 max-w-xl">
                          {snap.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => handleRestoreSnapshot(snap)}
                      className="bg-[#20252D] hover:bg-[#2A2F38] text-[#38BDF8] hover:text-white px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 border border-[#2A2F38] transition-colors cursor-pointer"
                      title="Restore this checkpoint: resets all active mods and load orders"
                      type="button"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Rollback</span>
                    </button>

                    <button
                      onClick={() => {
                        const manifest: LoadoutManifest = {
                          name: snap.name,
                          description: snap.notes,
                          sptVersion: snap.sptVersion,
                          exportedAt: snap.createdAt,
                          mods: snap.modSnapshots.map((m) => ({
                            id: m.id,
                            name: m.name,
                            version: m.version,
                            enabled: !m.isDisabled,
                            loadOrder: m.loadOrder,
                            kind: m.kind,
                          })),
                        };
                        handleDownloadManifest(manifest);
                      }}
                      className="p-1.5 rounded text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors cursor-pointer"
                      title="Export snapshot JSON"
                      type="button"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteSnapshot(snap.id, snap.name)}
                      className="p-1.5 rounded text-[#9AA3AF] hover:text-[#EF4444] hover:bg-[#2A1010] transition-colors cursor-pointer"
                      title="Delete snapshot checkpoint"
                      type="button"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Create Snapshot */}
      {showSnapshotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-md p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#23272E] mb-4">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-[#EA580C]" />
                <h3 className="text-sm font-bold text-[#E8EAEE]">Take Loadout Checkpoint</h3>
              </div>
              <button
                onClick={() => setShowSnapshotModal(false)}
                className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSnapshot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#CBD5E1] mb-1">
                  Checkpoint Name *
                </label>
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="e.g., Stable SAIN 3.0 Raid Build"
                  required
                  className="w-full bg-[#0E1013] border border-[#23272E] rounded-lg px-3 py-2 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#CBD5E1] mb-1">
                  Notes / Description (Optional)
                </label>
                <textarea
                  value={snapshotNotes}
                  onChange={(e) => setSnapshotNotes(e.target.value)}
                  placeholder="e.g., Working configuration before testing Realism Overhaul"
                  rows={2}
                  className="w-full bg-[#0E1013] border border-[#23272E] rounded-lg px-3 py-2 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
                />
              </div>

              <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3 text-xs text-[#9AA3AF]">
                <div className="flex items-center justify-between font-mono">
                  <span>Active Mods Included:</span>
                  <span className="text-[#22C55E] font-bold">
                    {installedMods.filter((m) => !m.isDisabled).length} of {installedMods.length}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono mt-1">
                  <span>SPT Target Version:</span>
                  <span className="text-[#E8EAEE]">{sptVersion}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSnapshotModal(false)}
                  className="px-3 py-1.5 text-xs text-[#9AA3AF] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#EA580C] hover:bg-[#F97316] text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Checkpoint</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Import Loadout / Share Code */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-lg p-5 shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#23272E] mb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#EA580C]" />
                <h3 className="text-sm font-bold text-[#E8EAEE]">Import Modpack / Loadout</h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div>
                <label className="block text-xs font-semibold text-[#CBD5E1] mb-1">
                  Paste Share Code (BS-...) or Manifest JSON:
                </label>
                <textarea
                  value={importInput}
                  onChange={(e) => handleImportInputChange(e.target.value)}
                  placeholder="Paste BS-... share string or raw JSON manifest here"
                  rows={4}
                  className="w-full bg-[#0E1013] border border-[#23272E] rounded-lg px-3 py-2 text-xs font-mono text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
                />
              </div>

              {/* File upload option */}
              <div className="flex items-center gap-3">
                <label className="bg-[#20252D] hover:bg-[#2A2F38] border border-[#2B303C] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer">
                  <FileText className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>Choose .JSON File</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <span className="text-[11px] text-[#6B7480]">
                  Supports exported Blacksite manifest files
                </span>
              </div>

              {importError && (
                <div className="bg-[#2A1010] border border-[#DC2626] rounded-lg p-2.5 text-xs text-[#EF4444] flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Parsed Diff Inspection Preview */}
              {parsedManifest && (
                <div className="bg-[#0E1013] border border-[#23272E] rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#23272E] pb-2">
                    <div>
                      <h4 className="text-xs font-bold text-[#E8EAEE]">{parsedManifest.name}</h4>
                      <p className="text-[11px] text-[#9AA3AF]">
                        Target SPT: {parsedManifest.sptVersion} · {parsedManifest.mods.length} mods listed
                      </p>
                    </div>
                    <span className="text-[10px] font-mono bg-[#22C55E]/15 text-[#22C55E] px-2 py-0.5 rounded">
                      Valid Manifest
                    </span>
                  </div>

                  {/* Diff Analysis */}
                  {(() => {
                    const toEnable = parsedManifest.mods.filter(
                      (m) => m.enabled && installedMap.has(m.id.toLowerCase())
                    );
                    const toDisable = parsedManifest.mods.filter(
                      (m) => !m.enabled && installedMap.has(m.id.toLowerCase())
                    );
                    const missing = parsedManifest.mods.filter(
                      (m) => m.enabled && !installedMap.has(m.id.toLowerCase())
                    );

                    return (
                      <div className="space-y-2 text-xs">
                        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                          <div className="bg-[#181B20] p-2 rounded border border-[#23272E]">
                            <span className="block text-[#22C55E] font-bold font-mono text-sm">
                              {toEnable.length}
                            </span>
                            <span className="text-[#9AA3AF]">Will Enable</span>
                          </div>
                          <div className="bg-[#181B20] p-2 rounded border border-[#23272E]">
                            <span className="block text-[#9AA3AF] font-bold font-mono text-sm">
                              {toDisable.length}
                            </span>
                            <span className="text-[#9AA3AF]">Will Disable</span>
                          </div>
                          <div className="bg-[#181B20] p-2 rounded border border-[#23272E]">
                            <span className="block text-[#F59E0B] font-bold font-mono text-sm">
                              {missing.length}
                            </span>
                            <span className="text-[#9AA3AF]">Missing</span>
                          </div>
                        </div>

                        {missing.length > 0 && (
                          <div className="bg-[#2A1D10] border border-[#F59E0B]/40 rounded-lg p-2.5 text-[11px] text-[#FBBF24]">
                            <div className="font-semibold flex items-center gap-1 mb-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Missing from Local Machine ({missing.length}):</span>
                            </div>
                            <div className="space-y-0.5 pl-4 font-mono">
                              {missing.slice(0, 5).map((m) => (
                                <div key={m.id}>• {m.name || m.id}</div>
                              ))}
                              {missing.length > 5 && (
                                <div className="text-[#9AA3AF]">
                                  + {missing.length - 5} more mods
                                </div>
                              )}
                            </div>
                            {onNavigateToBrowse && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowImportModal(false);
                                  onNavigateToBrowse();
                                }}
                                className="mt-2 text-xs text-[#EA580C] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                Find & install missing mods in Browse Tab →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#23272E] mt-3">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 text-xs text-[#9AA3AF] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!parsedManifest}
                onClick={handleApplyImportedManifest}
                className="bg-[#EA580C] hover:bg-[#F97316] disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Loadout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Export Active Loadout */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-md p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#23272E] mb-3">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#38BDF8]" />
                <h3 className="text-sm font-bold text-[#E8EAEE]">Share Current Loadout</h3>
              </div>
              <button
                onClick={() => {
                  setShowExportModal(false);
                  setCopiedShareCode(false);
                }}
                className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#CBD5E1] mb-1">
                  Compressed Share Code:
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={currentShareCode}
                    className="w-full bg-[#0E1013] border border-[#23272E] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#9AA3AF] select-all truncate"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentShareCode);
                      setCopiedShareCode(true);
                      setTimeout(() => setCopiedShareCode(false), 2000);
                      onShowToast('Copied', 'Share code copied to clipboard.', 'success');
                    }}
                    className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-lg border border-[#2B303C] text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                    type="button"
                  >
                    {copiedShareCode ? (
                      <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedShareCode ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-[#6B7480] mt-1">
                  Friends can paste this code in the "Import Loadout" dialog to replicate your exact setup.
                </p>
              </div>

              <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3 text-xs text-[#9AA3AF]">
                <div className="flex items-center justify-between font-mono mb-1">
                  <span>Active Mods:</span>
                  <span className="text-[#22C55E] font-semibold">
                    {installedMods.filter((m) => !m.isDisabled).length}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono">
                  <span>SPT Version:</span>
                  <span className="text-[#E8EAEE]">{sptVersion}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#23272E]">
                <button
                  type="button"
                  onClick={() => handleDownloadManifest(currentManifest)}
                  className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer border border-[#2B303C]"
                >
                  <Download className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>Download .JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowExportModal(false);
                    setCopiedShareCode(false);
                  }}
                  className="bg-[#EA580C] hover:bg-[#F97316] text-white px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
