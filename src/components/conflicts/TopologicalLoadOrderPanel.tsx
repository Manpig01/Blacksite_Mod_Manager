import React from 'react';
import { ListOrdered } from 'lucide-react';
import { InstalledMod } from '../../types';

interface TopologicalLoadOrderPanelProps {
  topologicalLoadOrder: string[];
  hasCycle: boolean;
  modMap: Map<string, InstalledMod>;
}

export const TopologicalLoadOrderPanel: React.FC<TopologicalLoadOrderPanelProps> = ({
  topologicalLoadOrder,
  hasCycle,
  modMap,
}) => {
  return (
    <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-5 shadow-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-[#EA580C]" />
          <h2 className="text-sm font-semibold text-white">
            Kahn&apos;s Topological Load Sequencing Order
          </h2>
        </div>
        <span className="text-[11px] text-[#9AA3AF]">
          {hasCycle ? (
            <span className="text-red-400 font-semibold">Partial (Cycles Detected)</span>
          ) : (
            <span className="text-emerald-400 font-semibold">Strict Acyclic Order Validated</span>
          )}
        </span>
      </div>

      <p className="text-xs text-[#9AA3AF]">
        Computed deterministic load sequence for SPT Server and BepInEx plugin lifecycle. Mods with zero inbound dependencies execute first.
      </p>

      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 bg-[#121418] rounded-lg border border-[#23272E]">
        {topologicalLoadOrder.map((modId, idx) => {
          const mod = modMap.get(modId);
          return (
            <span
              key={modId}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#20252D] text-xs text-[#E8EAEE] border border-[#2D333B] tabular-nums"
            >
              <span className="text-[10px] font-mono text-[#EA580C]">#{idx + 1}</span>
              <span className="font-medium">{mod?.name || modId}</span>
              <span className="text-[10px] text-[#6E7681] font-mono">v{mod?.version || '1.0'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
