import React from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  GitFork,
  Download,
  Sparkles,
  ListOrdered,
} from 'lucide-react';
import { ConflictMatrixReport } from '../../types';

interface ConflictSummaryHeaderProps {
  conflictReport: ConflictMatrixReport;
  showLoadOrderDrawer: boolean;
  resolvedNotice: string | null;
  onRefreshReport: () => void;
  onToggleLoadOrderDrawer: () => void;
  onAutoFixAll?: () => void;
  onExportDiagnostics: () => void;
}

export const ConflictSummaryHeader: React.FC<ConflictSummaryHeaderProps> = ({
  conflictReport,
  showLoadOrderDrawer,
  resolvedNotice,
  onRefreshReport,
  onToggleLoadOrderDrawer,
  onAutoFixAll,
  onExportDiagnostics,
}) => {
  const hasIssues = conflictReport.totalIssuesCount > 0;

  return (
    <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-5 shadow-lg relative overflow-hidden">
      {/* Glow accent */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${
          conflictReport.circularCount > 0
            ? 'bg-purple-500'
            : conflictReport.criticalCount > 0
            ? 'bg-red-500'
            : conflictReport.warningCount > 0
            ? 'bg-amber-500'
            : 'bg-emerald-500'
        }`}
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-lg border ${
                hasIssues
                  ? conflictReport.criticalCount > 0 || conflictReport.circularCount > 0
                    ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}
            >
              {hasIssues ? (
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Tactical Conflict Matrix
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] border border-[#2D333B]">
                  Tarjan SCC + VPI VFS
                </span>
              </h1>
              <p className="text-xs text-[#9AA3AF] mt-0.5">
                Real-time dependency loop detection, BepInEx binary collisions, and semantic config protection.
              </p>
            </div>
          </div>

          {/* Quick Badges Bar */}
          <div className="flex flex-wrap items-center gap-2 mt-4 tabular-nums">
            {conflictReport.circularCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                <GitFork className="w-3.5 h-3.5" />
                {conflictReport.circularCount} Circular Loop{conflictReport.circularCount > 1 ? 's' : ''}
              </span>
            )}
            {conflictReport.criticalCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30">
                <ShieldAlert className="w-3.5 h-3.5" />
                {conflictReport.criticalCount} Critical
              </span>
            )}
            {conflictReport.warningCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <AlertTriangle className="w-3.5 h-3.5" />
                {conflictReport.warningCount} Warning{conflictReport.warningCount > 1 ? 's' : ''}
              </span>
            )}
            {conflictReport.totalIssuesCount === 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Loadout Pristine — 0 Collisions
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefreshReport}
            className="px-3.5 py-2 text-xs font-medium rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#E8EAEE] border border-[#2D333B] flex items-center gap-2 transition-colors cursor-pointer"
            title="Re-run Tarjan SCC and Virtual Path scan"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-Scan</span>
          </button>

          <button
            type="button"
            onClick={onToggleLoadOrderDrawer}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg border flex items-center gap-2 transition-colors cursor-pointer tabular-nums ${
              showLoadOrderDrawer
                ? 'bg-[#EA580C]/15 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#20252D] hover:bg-[#2A303C] text-[#E8EAEE] border-[#2D333B]'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>Load Sequence ({conflictReport.topologicalLoadOrder.length})</span>
          </button>

          {onAutoFixAll && hasIssues && (
            <button
              type="button"
              onClick={onAutoFixAll}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#EA580C] hover:bg-[#F97316] text-white flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Fix Safe</span>
            </button>
          )}

          <button
            type="button"
            onClick={onExportDiagnostics}
            className="p-2 text-xs rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2D333B] transition-colors cursor-pointer"
            title="Export diagnostic report"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {resolvedNotice && (
        <div className="mt-3 py-1.5 px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{resolvedNotice}</span>
        </div>
      )}
    </div>
  );
};
