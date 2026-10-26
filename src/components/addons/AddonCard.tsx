import React from 'react';
import {
  Download,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Check,
  Info,
} from 'lucide-react';
import { Addon } from '../../types';
import { AddonThumbnail } from '../AddonThumbnail';

interface AddonCardProps {
  addon: Addon;
  parentInstalled: boolean;
  alreadyInstalled: boolean;
  onInspect: (addon: Addon) => void;
  onInstall: (addon: Addon) => void;
  onFilterByParentMod: (modId: number, modName: string) => void;
}

export const AddonCard: React.FC<AddonCardProps> = React.memo(
  ({
    addon,
    parentInstalled,
    alreadyInstalled,
    onInspect,
    onInstall,
    onFilterByParentMod,
  }) => {
    const latestVer = addon.versions && addon.versions.length > 0 ? addon.versions[0] : null;

    return (
      <div className="bg-[#181B20] border border-[#23272E] hover:border-[#2A303C] rounded-lg overflow-hidden flex flex-col transition-all group hover:shadow-lg">
        {/* Thumbnail / Header Preview */}
        <div
          onClick={() => onInspect(addon)}
          className="h-28 bg-[#101216] relative overflow-hidden flex items-center justify-center border-b border-[#23272E] cursor-pointer"
        >
          <AddonThumbnail
            addon={addon}
            className="group-hover:scale-105 transition-transform duration-300"
          />

          {/* Version Badge */}
          {latestVer && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-[#121418]/90 backdrop-blur-xs border border-[#2A303C] text-[10px] font-mono tabular-nums rounded text-[#9AA3AF]">
              v{latestVer.version}
            </div>
          )}

          {/* Installed Status Overlay */}
          {alreadyInstalled && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981] text-[10px] font-semibold rounded flex items-center gap-1 backdrop-blur-xs">
              <Check className="w-2.5 h-2.5" />
              <span>Installed</span>
            </div>
          )}

          {/* Quick Inspect Hover Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-semibold backdrop-blur-[1px]">
            <Info className="w-4 h-4 text-[#EA580C]" />
            <span>View Details & Versions</span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
          <div>
            {/* Title & Author */}
            <h3
              onClick={() => onInspect(addon)}
              className="text-sm font-semibold text-[#E8EAEE] line-clamp-1 group-hover:text-[#EA580C] transition-colors cursor-pointer"
              title={addon.name}
            >
              {addon.name}
            </h3>
            <div className="text-[11px] text-[#9AA3AF] mt-0.5 flex items-center gap-1.5">
              <span>by {addon.authors?.[0]?.name || 'Community'}</span>
              {addon.downloads !== undefined && (
                <>
                  <span>•</span>
                  <span className="font-mono tabular-nums">{addon.downloads.toLocaleString()} DLs</span>
                </>
              )}
            </div>

            {/* Teaser Description */}
            <p className="text-xs text-[#9AA3AF] mt-2 line-clamp-2 leading-relaxed">
              {addon.teaser ||
                (addon.description ? addon.description.replace(/<[^>]*>/g, '') : '') ||
                'Modular preset configuration for SPT.'}
            </p>
          </div>

          {/* Parent Mod Relationship Box */}
          <div className="space-y-2 pt-2 border-t border-[#23272E]">
            {addon.mod ? (
              <div
                className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${
                  parentInstalled
                    ? 'bg-[#10B981]/10 border-[#10B981]/25 text-[#10B981]'
                    : 'bg-[#F59E0B]/10 border-[#F59E0B]/25 text-[#F59E0B]'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {parentInstalled ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#10B981]" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#F59E0B]" />
                  )}
                  <span className="truncate text-[11px]" title={`Parent Mod: ${addon.mod.name}`}>
                    Parent: <strong>{addon.mod.name}</strong>
                  </span>
                </div>

                <div className="shrink-0 flex items-center gap-1.5">
                  {parentInstalled ? (
                    <span className="text-[10px] uppercase font-mono font-bold bg-[#10B981]/20 px-1 py-0.5 rounded">
                      Ready
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-mono font-bold bg-[#F59E0B]/20 px-1 py-0.5 rounded">
                      Missing
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFilterByParentMod(addon.mod!.id, addon.mod!.name);
                    }}
                    className="text-[10px] px-1 py-0.5 bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] rounded border border-[#2A303C] cursor-pointer"
                    title="Filter all addons for this mod"
                  >
                    Filter
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-[#9AA3AF] italic">
                Standalone / General Mod Component
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onInstall(addon)}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  parentInstalled
                    ? 'bg-[#EA580C] hover:bg-[#EA580C]/90 text-white shadow-sm'
                    : 'bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C]'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>{alreadyInstalled ? 'Reinstall' : 'Install Addon'}</span>
              </button>

              <button
                type="button"
                onClick={() => onInspect(addon)}
                className="p-1.5 bg-[#20252D] hover:bg-[#282E38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A303C] rounded transition-colors cursor-pointer"
                title="Inspect Details & Versions"
              >
                <Info className="w-3.5 h-3.5" />
              </button>

              <a
                href={`https://sp-mod.com/addon/${addon.id}/${addon.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 bg-[#20252D] hover:bg-[#282E38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A303C] rounded transition-colors"
                title="View on sp-mod.com"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

AddonCard.displayName = 'AddonCard';
