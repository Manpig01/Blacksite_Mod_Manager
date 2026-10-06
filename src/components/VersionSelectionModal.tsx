import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Calendar,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { Mod, ModVersion } from '../types';
import { apiService } from '../services/apiService';
import { sortModVersionsByMostRecent } from '../utils/versionUtils';

interface VersionSelectionModalProps {
  mod: Mod | null;
  recoveryNotice?: string | null;
  onClose: () => void;
  onSelectVersion: (mod: Mod, version: ModVersion) => void;
  onInstallFromFile?: (file: File) => void;
}

export const VersionSelectionModal: React.FC<VersionSelectionModalProps> = ({
  mod,
  recoveryNotice,
  onClose,
  onSelectVersion,
  onInstallFromFile,
}) => {
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mod) return;
    setLoading(true);
    apiService
      .getModVersions(mod.id)
      .then((res) => {
        setVersions(sortModVersionsByMostRecent(res));
      })
      .finally(() => setLoading(false));
  }, [mod]);

  if (!mod) return null;

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onInstallFromFile) {
      onInstallFromFile(e.target.files[0]);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-[#E8EAEE]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#121418]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/30 text-[#EA580C]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE] tracking-tight">
                Version History & Selection
              </h2>
              <p className="text-xs text-[#9AA3AF] mt-0.5">
                {mod.name} by {mod.owner?.name || 'Community'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1.5 hover:bg-[#20252D] rounded-md transition-colors cursor-pointer"
            type="button"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 404 Recovery notice banner */}
        {recoveryNotice && (
          <div className="px-5 py-3 bg-[#2A1710] border-b border-[#EA580C]/40 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#F97316] shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-[#FDBA74]">Download Link Unavailable</p>
              <p className="text-[#FED7AA]">{recoveryNotice}</p>
              <p className="text-[#9AA3AF] text-[11px]">
                Please select the latest verified release below, or download manually from the Forge page.
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#9AA3AF]">
              <div className="w-7 h-7 border-2 border-[#EA580C] border-t-transparent rounded-full animate-spin mb-2.5"></div>
              <p className="text-xs">Querying latest releases and verification data...</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-[#9AA3AF] space-y-2">
              <p className="text-sm">No version history retrieved for this mod.</p>
              {mod.detail_url && (
                <a
                  href={mod.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#EA580C] hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on sp-mod.com
                </a>
              )}
            </div>
          ) : (
            versions.map((ver, idx) => {
              const isLatest = idx === 0;
              const sizeMb = ver.content_length
                ? (ver.content_length / (1024 * 1024)).toFixed(2)
                : null;
              const cleanDescription = ver.description
                ? ver.description.replace(/<[^>]+>/g, ' ').trim()
                : 'Stable release update.';

              return (
                <div
                  key={ver.id || ver.version}
                  className={`border rounded-lg p-3.5 space-y-2.5 transition-all ${
                    isLatest
                      ? 'bg-[#161B22] border-[#EA580C]/40 shadow-[0_0_12px_rgba(234,88,12,0.06)]'
                      : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#E8EAEE] font-mono">
                        v{ver.version}
                      </span>
                      {isLatest && (
                        <span className="bg-[#EA580C]/20 border border-[#EA580C]/50 text-[#EA580C] text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-[#EA580C]" /> Latest
                        </span>
                      )}
                      {ver.spt_version_constraint && (
                        <span className="bg-[#16A34A]/20 border border-[#16A34A]/50 text-[#4ADE80] text-[10.5px] font-semibold px-2 py-0.5 rounded">
                          SPT {ver.spt_version_constraint}
                        </span>
                      )}
                      {ver.fika_compatibility === 'compatible' && (
                        <span className="bg-[#0E2A18] border border-[#16A34A]/60 text-[#4ADE80] text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          Fika Compatible
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => onSelectVersion(mod, ver)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer ${
                        isLatest
                          ? 'bg-[#16A34A] hover:bg-[#22C55E] text-white'
                          : 'bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] border border-[#2A2F38]'
                      }`}
                      type="button"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isLatest ? 'Install Latest' : 'Install Release'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[#9AA3AF] flex-wrap">
                    {ver.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#6B7480]" />
                        {new Date(ver.published_at).toLocaleDateString()}
                      </span>
                    )}
                    {sizeMb && (
                      <span className="flex items-center gap-1 font-mono">
                        <HardDrive className="w-3.5 h-3.5 text-[#6B7480]" />
                        {sizeMb} MB
                      </span>
                    )}
                    {ver.downloads > 0 && (
                      <span className="font-mono">{ver.downloads.toLocaleString()} downloads</span>
                    )}
                  </div>

                  <p className="text-xs text-[#9AA3AF] bg-[#0E1013] p-2 rounded border border-[#23272E] leading-relaxed line-clamp-3 font-sans">
                    {cleanDescription}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Forge link & manual file upload */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#121418] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {mod.detail_url && (
              <a
                href={mod.detail_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Forge page</span>
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onInstallFromFile && (
              <label className="cursor-pointer px-3 py-1.5 text-xs text-[#C2C9D6] hover:text-white bg-[#20252D] hover:bg-[#2A2F38] border border-[#2A2F38] rounded-md transition-colors flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>Choose local archive...</span>
                <input
                  type="file"
                  accept=".zip,.7z,.rar"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </label>
            )}
            <button
              onClick={onClose}
              type="button"
              className="px-3.5 py-1.5 text-xs font-semibold text-[#9AA3AF] hover:text-white transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
