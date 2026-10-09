import React, { useState, useMemo } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileJson,
  FileSpreadsheet,
  CheckSquare,
  FileText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { InstalledMod } from '../types';

export type ExportFormat = 'json' | 'csv';
export type ExportScope = 'all' | 'selected' | 'enabled';

export interface ExportModsModalProps {
  isOpen: boolean;
  onClose: () => void;
  installedMods: InstalledMod[];
  selectedModIds?: Set<string>;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const ExportModsModal: React.FC<ExportModsModalProps> = ({
  isOpen,
  onClose,
  installedMods,
  selectedModIds = new Set(),
  onShowToast,
}) => {
  const hasSelection = selectedModIds.size > 0;
  const [format, setFormat] = useState<ExportFormat>('json');
  const [scope, setScope] = useState<ExportScope>(hasSelection ? 'selected' : 'all');
  const [includePaths, setIncludePaths] = useState(true);
  const [includeTags, setIncludeTags] = useState(true);
  const [includeConfigs, setIncludeConfigs] = useState(true);
  const [copied, setCopied] = useState(false);

  // Target mods list based on scope
  const targetMods = useMemo(() => {
    let list: InstalledMod[] = [];
    if (scope === 'selected' && hasSelection) {
      list = installedMods.filter((m) => selectedModIds.has(m.id));
    } else if (scope === 'enabled') {
      list = installedMods.filter((m) => !m.isDisabled);
    } else {
      list = installedMods;
    }

    // Stable sort by load order or name
    return [...list].sort((a, b) => {
      const orderA = a.loadOrder ?? 9999;
      const orderB = b.loadOrder ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [installedMods, scope, selectedModIds, hasSelection]);

  // Generate JSON Payload
  const jsonPayload = useMemo(() => {
    const data = {
      manifestVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      generator: 'Blacksite Mod Manager v2.0.0',
      exportScope: scope,
      summary: {
        totalExported: targetMods.length,
        activeMods: targetMods.filter((m) => !m.isDisabled).length,
        disabledMods: targetMods.filter((m) => m.isDisabled).length,
      },
      mods: targetMods.map((m) => {
        const item: Record<string, any> = {
          loadOrder: m.loadOrder ?? null,
          id: m.id,
          name: m.name,
          version: m.version,
          author: m.author,
          kind: m.kind,
          status: m.isDisabled ? 'disabled' : 'enabled',
          installDate: m.installDate,
        };

        if (includePaths) {
          item.serverPath = m.serverPath || null;
          item.clientPath = m.clientPath || null;
        }

        if (includeTags) {
          item.tags = m.tags?.map((t) => t.name) || [];
        }

        item.dependencies = m.dependencies || [];

        if (includeConfigs) {
          item.configFiles = m.configFiles?.map((c) => ({
            fileName: c.fileName,
            relativePath: c.relativePath,
          })) || [];
        }

        return item;
      }),
    };

    return JSON.stringify(data, null, 2);
  }, [targetMods, scope, includePaths, includeTags, includeConfigs]);

  // Generate CSV Payload (RFC 4180 compliant)
  const csvPayload = useMemo(() => {
    const escapeCsv = (val: string | number | undefined | null) => {
      if (val === undefined || val === null) return '""';
      const s = String(val);
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return `"${s}"`;
    };

    const headers = [
      'Load Order',
      'Name',
      'Package ID',
      'Version',
      'Type',
      'Status',
      'Author',
      'Install Date',
      'Dependencies',
    ];

    if (includeTags) headers.push('Tags');
    if (includePaths) {
      headers.push('Server Path');
      headers.push('Client Path');
    }
    if (includeConfigs) headers.push('Config Files');

    const rows = targetMods.map((m) => {
      const row = [
        escapeCsv(m.loadOrder ?? ''),
        escapeCsv(m.name),
        escapeCsv(m.id),
        escapeCsv(m.version),
        escapeCsv(m.kind),
        escapeCsv(m.isDisabled ? 'Disabled' : 'Enabled'),
        escapeCsv(m.author),
        escapeCsv(m.installDate),
        escapeCsv((m.dependencies || []).join('; ')),
      ];

      if (includeTags) {
        row.push(escapeCsv((m.tags || []).map((t) => t.name).join('; ')));
      }
      if (includePaths) {
        row.push(escapeCsv(m.serverPath || ''));
        row.push(escapeCsv(m.clientPath || ''));
      }
      if (includeConfigs) {
        row.push(escapeCsv((m.configFiles || []).map((c) => c.relativePath || c.fileName).join('; ')));
      }

      return row.join(',');
    });

    return [headers.map((h) => `"${h}"`).join(','), ...rows].join('\r\n');
  }, [targetMods, includeTags, includePaths, includeConfigs]);

  const activePayload = format === 'json' ? jsonPayload : csvPayload;
  const payloadLines = useMemo(() => activePayload.split('\n').length, [activePayload]);
  const payloadBytes = useMemo(() => new Blob([activePayload]).size, [activePayload]);
  const formattedSize = useMemo(() => {
    if (payloadBytes < 1024) return `${payloadBytes} B`;
    return `${(payloadBytes / 1024).toFixed(1)} KB`;
  }, [payloadBytes]);

  if (!isOpen) return null;

  // Handle Download File
  const handleDownload = () => {
    try {
      const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
      const ext = format === 'json' ? 'json' : 'csv';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `blacksite-mods-manifest-${timestamp}.${ext}`;

      const blob = new Blob([activePayload], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onShowToast(
        'Export Successful',
        `Saved ${targetMods.length} mod records to ${filename}.`,
        'success'
      );
      onClose();
    } catch (err: any) {
      onShowToast('Export Failed', err?.message || 'Could not trigger file download.', 'error');
    }
  };

  // Handle Copy to Clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activePayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onShowToast('Copied to Clipboard', `Copied ${targetMods.length} mod records in ${format.toUpperCase()} format.`, 'info');
    } catch (err) {
      onShowToast('Copy Failed', 'Clipboard access denied or unavailable.', 'error');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#16191E] border border-[#2A2F38] rounded-xl w-full max-w-3xl flex flex-col shadow-2xl max-h-[90vh] overflow-hidden text-[#E8EAEE]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23272E] bg-[#121418]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/30 text-[#EA580C]">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-base font-bold text-white tracking-tight">
                Export Installed Mods
              </h2>
              <p className="text-xs text-[#9AA3AF] mt-0.5">
                Generate a structured manifest or spreadsheet of your Single Player Tarkov loadout
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1.5 rounded-md hover:bg-[#20252D] transition-colors cursor-pointer"
            title="Close (Esc)"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Top Options Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Format Selector */}
            <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3.5">
              <label className="block text-xs font-semibold text-[#9AA3AF] uppercase tracking-wider mb-2">
                Export Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormat('json')}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-left cursor-pointer transition-all ${
                    format === 'json'
                      ? 'bg-[#EA580C]/20 border-[#EA580C] text-white shadow-xs'
                      : 'bg-[#181B20] border-[#2A2F38] text-[#9AA3AF] hover:text-white hover:border-[#3E4552]'
                  }`}
                >
                  <FileJson className={`w-4 h-4 ${format === 'json' ? 'text-[#EA580C]' : 'text-[#6B7480]'}`} />
                  <div>
                    <div className="text-xs font-bold leading-tight">JSON Manifest</div>
                    <div className="text-[10px] text-[#9AA3AF] leading-tight mt-0.5">Full backup & configs</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormat('csv')}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-left cursor-pointer transition-all ${
                    format === 'csv'
                      ? 'bg-[#EA580C]/20 border-[#EA580C] text-white shadow-xs'
                      : 'bg-[#181B20] border-[#2A2F38] text-[#9AA3AF] hover:text-white hover:border-[#3E4552]'
                  }`}
                >
                  <FileSpreadsheet className={`w-4 h-4 ${format === 'csv' ? 'text-[#EA580C]' : 'text-[#6B7480]'}`} />
                  <div>
                    <div className="text-xs font-bold leading-tight">CSV Spreadsheet</div>
                    <div className="text-[10px] text-[#9AA3AF] leading-tight mt-0.5">Excel & Discord sharing</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Scope Selector */}
            <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3.5">
              <label className="block text-xs font-semibold text-[#9AA3AF] uppercase tracking-wider mb-2">
                Export Scope
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {hasSelection && (
                  <button
                    type="button"
                    onClick={() => setScope('selected')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                      scope === 'selected'
                        ? 'bg-[#EA580C] text-white border-[#EA580C]'
                        : 'bg-[#181B20] border-[#2A2F38] text-[#9AA3AF] hover:text-white'
                    }`}
                  >
                    Selected Only ({selectedModIds.size})
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                    scope === 'all'
                      ? 'bg-[#EA580C] text-white border-[#EA580C]'
                      : 'bg-[#181B20] border-[#2A2F38] text-[#9AA3AF] hover:text-white'
                  }`}
                >
                  All Installed ({installedMods.length})
                </button>

                <button
                  type="button"
                  onClick={() => setScope('enabled')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                    scope === 'enabled'
                      ? 'bg-[#EA580C] text-white border-[#EA580C]'
                      : 'bg-[#181B20] border-[#2A2F38] text-[#9AA3AF] hover:text-white'
                  }`}
                >
                  Active Only ({installedMods.filter((m) => !m.isDisabled).length})
                </button>
              </div>
            </div>
          </div>

          {/* Granular Field Inclusions */}
          <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3.5 flex items-center justify-between flex-wrap gap-4 text-xs">
            <span className="font-semibold text-[#9AA3AF]">Include in Export:</span>
            <div className="flex items-center gap-5 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none text-[#E8EAEE] hover:text-white">
                <input
                  type="checkbox"
                  checked={includePaths}
                  onChange={(e) => setIncludePaths(e.target.checked)}
                  className="rounded border-[#2A2F38] bg-[#181B20] text-[#EA580C] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span>Local File Paths</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-[#E8EAEE] hover:text-white">
                <input
                  type="checkbox"
                  checked={includeTags}
                  onChange={(e) => setIncludeTags(e.target.checked)}
                  className="rounded border-[#2A2F38] bg-[#181B20] text-[#EA580C] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span>Custom Organization Tags</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-[#E8EAEE] hover:text-white">
                <input
                  type="checkbox"
                  checked={includeConfigs}
                  onChange={(e) => setIncludeConfigs(e.target.checked)}
                  className="rounded border-[#2A2F38] bg-[#181B20] text-[#EA580C] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span>Config Files Manifest</span>
              </label>
            </div>
          </div>

          {/* Live Code Preview Section */}
          <div className="border border-[#23272E] rounded-lg overflow-hidden bg-[#0A0C0E]">
            <div className="flex items-center justify-between px-4 py-2 bg-[#121418] border-b border-[#23272E] text-xs">
              <div className="flex items-center gap-2 text-[#9AA3AF]">
                <FileText className="w-3.5 h-3.5 text-[#EA580C]" />
                <span className="font-medium text-white">Live Payload Preview</span>
                <span className="text-[#6B7480]">·</span>
                <span className="font-mono tabular-nums">{targetMods.length} mods</span>
                <span className="text-[#6B7480]">·</span>
                <span className="font-mono tabular-nums">{payloadLines} lines</span>
                <span className="text-[#6B7480]">·</span>
                <span className="font-mono tabular-nums">{formattedSize}</span>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] hover:text-white transition-colors cursor-pointer text-[11px] font-medium"
                title="Copy raw payload to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                    <span className="text-[#22C55E]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#9AA3AF]" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            </div>

            {/* Monospace Code View Area */}
            <div className="p-3.5 font-mono text-[11px] text-[#A6ACCD] overflow-x-auto max-h-[220px] overflow-y-auto leading-relaxed select-text scrollbar-thin">
              <pre className="whitespace-pre">{activePayload}</pre>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#23272E] bg-[#121418]">
          <div className="text-xs text-[#9AA3AF] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#22C55E]" />
            <span>Ready for offline backup or sharing. Zero external network transfer.</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 rounded-md bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-[#2A2F38]"
            >
              {copied ? <Check className="w-4 h-4 text-[#22C55E]" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="px-5 py-2 rounded-md bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-orange-950"
            >
              <Download className="w-4 h-4" />
              <span>Download {format.toUpperCase()}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
