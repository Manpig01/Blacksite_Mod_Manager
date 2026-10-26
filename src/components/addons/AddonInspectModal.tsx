import React from 'react';
import { Download, ExternalLink, Layers, X } from 'lucide-react';
import { Addon, AddonVersion } from '../../types';
import { AddonThumbnail } from '../AddonThumbnail';

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AddonInspectModalProps {
  addon: Addon | null;
  parentInstalled: boolean;
  onClose: () => void;
  onInstallVersion: (addon: Addon, version: AddonVersion) => void;
  onNavigateToMod?: (modId: number) => void;
}

export const AddonInspectModal: React.FC<AddonInspectModalProps> = ({
  addon,
  parentInstalled,
  onClose,
  onInstallVersion,
  onNavigateToMod,
}) => {
  if (!addon) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#181B20] border border-[#23272E] rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#1C2026]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#2A303C] shrink-0 bg-[#121418]">
              <AddonThumbnail addon={addon} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE]">{addon.name}</h2>
              <p className="text-xs text-[#9AA3AF] tabular-nums">
                by {addon.authors?.[0]?.name || 'Community Author'} • {addon.downloads?.toLocaleString() || 0} downloads
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#282E38] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar text-xs">
          {/* Parent Mod Banner */}
          {addon.mod && (
            <div className="p-3 rounded-lg border bg-[#121418] border-[#2A303C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-[#EA580C]" />
                <div>
                  <div className="font-semibold text-[#E8EAEE]">
                    Parent Mod: {addon.mod.name}
                  </div>
                  <div className="text-[11px] text-[#9AA3AF]">
                    {parentInstalled
                      ? '✓ Base mod is currently installed in your loadout'
                      : '⚠️ Base mod is not installed. You will be prompted to install it together.'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onNavigateToMod && addon.mod_id && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigateToMod(addon.mod_id);
                    }}
                    className="px-2.5 py-1 bg-[#20252D] hover:bg-[#282E38] text-white rounded border border-[#2A303C] text-[11px] font-medium cursor-pointer"
                  >
                    View Mod
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <h4 className="font-bold text-[#E8EAEE] uppercase tracking-wider text-[11px] mb-1.5">Description</h4>
            <div
              className="p-3 rounded bg-[#121418] border border-[#23272E] text-[#9AA3AF] leading-relaxed max-h-48 overflow-y-auto prose prose-invert prose-xs"
              dangerouslySetInnerHTML={{
                __html: addon.description || addon.teaser || 'No detailed description provided.',
              }}
            />
          </div>

          {/* Available Versions */}
          <div>
            <h4 className="font-bold text-[#E8EAEE] uppercase tracking-wider text-[11px] mb-2 flex items-center justify-between">
              <span>Available Releases ({addon.versions?.length || 0})</span>
              <span className="text-[10px] text-[#9AA3AF] font-normal">Choose version to install</span>
            </h4>

            {!addon.versions || addon.versions.length === 0 ? (
              <div className="p-3 rounded bg-[#121418] border border-[#23272E] text-center text-[#9AA3AF]">
                No versions listed. You can install the default package.
              </div>
            ) : (
              <div className="space-y-2">
                {addon.versions.map((ver) => (
                  <div
                    key={ver.id}
                    className="p-3 rounded bg-[#121418] border border-[#23272E] hover:border-[#2A303C] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums font-bold text-[#E8EAEE] text-xs">
                          v{ver.version}
                        </span>
                        {ver.mod_version_constraint && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-[#20252D] border border-[#2A303C] text-[10px] font-mono text-[#9AA3AF]"
                            title="Requires Base Mod Version"
                          >
                            Requires {ver.mod_version_constraint}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-[#9AA3AF] tabular-nums">
                        <span>{ver.downloads?.toLocaleString() || 0} downloads</span>
                        <span>•</span>
                        <span>{formatBytes(ver.content_length)}</span>
                        {ver.published_at && (
                          <>
                            <span>•</span>
                            <span>{new Date(ver.published_at).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                      {ver.changelog && (
                        <p className="text-[11px] text-[#6B7280] line-clamp-1">
                          {ver.changelog.replace(/<[^>]*>/g, '')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onInstallVersion(addon, ver);
                          onClose();
                        }}
                        className="px-3 py-1.5 bg-[#EA580C] hover:bg-[#EA580C]/90 text-white rounded font-medium text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Install v{ver.version}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#1C2026] flex items-center justify-between">
          <a
            href={`https://sp-mod.com/addon/${addon.id}/${addon.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open on sp-mod.com</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#20252D] hover:bg-[#282E38] text-xs font-medium rounded border border-[#2A303C] text-[#E8EAEE] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
