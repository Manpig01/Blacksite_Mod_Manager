import React, { useState, useEffect } from 'react';
import { X, Download, Calendar, HardDrive, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Mod, ModVersion } from '../types';
import { apiService } from '../services/apiService';

interface VersionSelectionModalProps {
  mod: Mod | null;
  onClose: () => void;
  onSelectVersion: (mod: Mod, version: ModVersion) => void;
}

export const VersionSelectionModal: React.FC<VersionSelectionModalProps> = ({
  mod,
  onClose,
  onSelectVersion,
}) => {
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mod) return;
    setLoading(true);
    apiService
      .getModVersions(mod.id)
      .then((res) => {
        setVersions(res);
      })
      .finally(() => setLoading(false));
  }, [mod]);

  if (!mod) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#E8EAEE]">Select Version for {mod.name}</h2>
            <p className="text-xs text-[#9AA3AF] mt-0.5">
              Choose a specific release to download and extract into your SPT installation
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded transition-colors cursor-pointer"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#9AA3AF]">
              <div className="w-6 h-6 border-2 border-[#EA580C] border-t-transparent rounded-full animate-spin mb-2"></div>
              <p className="text-xs">Fetching releases from sp-mod.com...</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-[#9AA3AF]">
              No release history found for this mod.
            </div>
          ) : (
            versions.map((ver) => {
              const sizeMb = ver.content_length
                ? (ver.content_length / (1024 * 1024)).toFixed(2)
                : '1.2';
              const cleanDescription = ver.description
                ? ver.description.replace(/<[^>]+>/g, ' ').trim()
                : 'Stable release update.';

              return (
                <div
                  key={ver.id || ver.version}
                  className="bg-[#121418] border border-[#23272E] hover:border-[#3A4150] rounded-lg p-3.5 space-y-2 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-[#E8EAEE] font-mono">
                        v{ver.version}
                      </span>
                      {ver.spt_version_constraint && (
                        <span className="bg-[#16A34A]/20 border border-[#16A34A]/50 text-[#22C55E] text-[10.5px] font-semibold px-2 py-0.5 rounded">
                          SPT {ver.spt_version_constraint}
                        </span>
                      )}
                      {ver.fika_compatibility === 'compatible' && (
                        <span className="bg-[#0E2A18] border border-[#16A34A] text-[#22C55E] text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          Fika Compatible
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => onSelectVersion(mod, ver)}
                      className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                      type="button"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install this version</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[#9AA3AF]">
                    {ver.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#6B7480]" />
                        {new Date(ver.published_at).toLocaleDateString()}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-[#6B7480]" />
                      {sizeMb} MB
                    </span>
                    <span>{ver.downloads.toLocaleString()} downloads</span>
                  </div>

                  <p className="text-xs text-[#9AA3AF] bg-[#0E1013] p-2 rounded border border-[#23272E] leading-relaxed line-clamp-3">
                    {cleanDescription}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
