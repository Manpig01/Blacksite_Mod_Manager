import React, { useState, useEffect, useMemo } from 'react';
import {
  Terminal,
  Copy,
  Download,
  Search,
  X,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { errorLogService, ErrorLogEntry } from '../../services/errorLogService';
import { ConfirmOptions } from '../../hooks/useConfirmDialog';

interface DiagnosticLogSectionProps {
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  onRequestConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const DiagnosticLogSection: React.FC<DiagnosticLogSectionProps> = React.memo(({
  onShowToast,
  onRequestConfirm,
}) => {
  const [logs, setLogs] = useState<ErrorLogEntry[]>(() => errorLogService.getLogs());
  const [selectedLogLevel, setSelectedLogLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = errorLogService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return unsubscribe;
  }, []);

  const toggleExpandLog = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyAllLogs = () => {
    const text = errorLogService.exportLogsAsText();
    if (!text.trim()) {
      onShowToast('Logs Empty', 'There are no diagnostic error logs to copy.', 'info');
      return;
    }
    navigator.clipboard.writeText(text);
    onShowToast('Logs Copied', 'All diagnostic error logs copied to clipboard.', 'success');
  };

  const handleCopySingleLog = (log: ErrorLogEntry) => {
    let text = `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}]${
      log.modName ? ` [${log.modName}]` : ''
    }: ${log.message}`;
    if (log.command) text += `\nCommand: ${log.command}`;
    if (log.details) text += `\nDetails:\n${log.details}`;
    navigator.clipboard.writeText(text);
    setCopiedLogId(log.id);
    setTimeout(() => setCopiedLogId(null), 2000);
    onShowToast('Log Entry Copied', 'Copied log entry to clipboard.', 'info');
  };

  const handleExportLogsFile = () => {
    const text = errorLogService.exportLogsAsText();
    if (!text.trim()) {
      onShowToast('Logs Empty', 'No logs available to export.', 'info');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacksite-diagnostic-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Logs Exported', 'Diagnostic log file downloaded.', 'success');
  };

  const handleClearLogs = async () => {
    if (logs.length === 0) return;
    const confirmed = await onRequestConfirm({
      title: 'Clear Diagnostic Logs',
      message: 'Clear all recorded diagnostic and error logs from memory and storage?',
      confirmLabel: 'Clear Logs',
      severity: 'warning',
    });
    if (confirmed) {
      errorLogService.clearLogs();
      onShowToast('Logs Cleared', 'Diagnostic log history was wiped.', 'info');
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (selectedLogLevel !== 'all' && l.level !== selectedLogLevel) return false;
      if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase();
        const msgMatch = l.message.toLowerCase().includes(q);
        const modMatch = (l.modName || '').toLowerCase().includes(q);
        const srcMatch = l.source.toLowerCase().includes(q);
        const detMatch = (l.details || '').toLowerCase().includes(q);
        if (!msgMatch && !modMatch && !srcMatch && !detMatch) return false;
      }
      return true;
    });
  }, [logs, selectedLogLevel, logSearchQuery]);

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] font-bold text-[#E8EAEE] flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#EF4444]" />
          <span>Error & Diagnostic Logs</span>
          {errorCount > 0 ? (
            <span className="bg-[#7F1D1D]/50 border border-[#DC2626] text-[#FCA5A5] text-[10.5px] font-mono px-2 py-0.5 rounded-full font-bold">
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          ) : null}
          {warnCount > 0 ? (
            <span className="bg-[#78350F]/50 border border-[#D97706] text-[#FDE68A] text-[10.5px] font-mono px-2 py-0.5 rounded-full font-bold">
              {warnCount} warning{warnCount > 1 ? 's' : ''}
            </span>
          ) : null}
          <span className="text-xs font-mono text-[#6B7480]">({logs.length} total recorded)</span>
        </h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAllLogs}
            disabled={logs.length === 0}
            className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] disabled:opacity-40 flex items-center gap-1 cursor-pointer transition-colors"
            title="Copy entire log history to clipboard"
          >
            <Copy className="w-3 h-3" />
            <span>Copy All</span>
          </button>
          <span className="text-[#3A3F4A]">·</span>
          <button
            type="button"
            onClick={handleExportLogsFile}
            disabled={logs.length === 0}
            className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] disabled:opacity-40 flex items-center gap-1 cursor-pointer transition-colors"
            title="Download diagnostic log file as text"
          >
            <Download className="w-3 h-3" />
            <span>Export .txt</span>
          </button>
        </div>
      </div>

      <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3.5">
        <p className="text-xs text-[#9AA3AF]">
          Detailed execution logs, large archive extraction failures (e.g. buffer overflows or corrupted archives), and dependency resolution traces are preserved here to troubleshoot installation errors.
        </p>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 pb-1">
          <div className="flex items-center gap-1 bg-[#121418] p-1 rounded-lg border border-[#23272E]">
            <button
              type="button"
              onClick={() => setSelectedLogLevel('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                selectedLogLevel === 'all'
                  ? 'bg-[#20252D] text-[#E8EAEE] shadow-xs'
                  : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedLogLevel('error')}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                selectedLogLevel === 'error'
                  ? 'bg-[#7F1D1D]/60 text-[#FCA5A5] shadow-xs font-semibold'
                  : 'text-[#9AA3AF] hover:text-[#EF4444]'
              }`}
            >
              Errors ({errorCount})
            </button>
            <button
              type="button"
              onClick={() => setSelectedLogLevel('warn')}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                selectedLogLevel === 'warn'
                  ? 'bg-[#78350F]/60 text-[#FDE68A] shadow-xs font-semibold'
                  : 'text-[#9AA3AF] hover:text-[#F59E0B]'
              }`}
            >
              Warnings ({warnCount})
            </button>
          </div>

          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              placeholder="Search error messages or mods..."
              className="w-full bg-[#121418] border border-[#23272E] text-xs text-[#E8EAEE] pl-8 pr-7 py-1.5 rounded-lg focus:outline-none focus:border-[#EA580C]"
            />
            {logSearchQuery && (
              <button
                type="button"
                onClick={() => setLogSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7480] hover:text-[#E8EAEE]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {logs.length > 0 && (
            <button
              type="button"
              onClick={handleClearLogs}
              className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer border border-[#2A2F38]"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Logs</span>
            </button>
          )}
        </div>

        {/* Logs Container */}
        <div className="bg-[#0C0E12] border border-[#23272E] rounded-lg overflow-hidden max-h-[380px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center select-none">
              <CheckCircle2 className="w-8 h-8 text-[#22C55E]/60 mb-2" />
              <span className="text-xs font-semibold text-[#E8EAEE]">
                {logs.length === 0 ? 'No diagnostic or error logs recorded' : 'No logs match your filter criteria'}
              </span>
              <span className="text-[11px] text-[#6B7480] mt-1 max-w-sm">
                {logs.length === 0
                  ? 'Mod downloads, archive extractions, and directory routing are operating cleanly.'
                  : 'Try clearing the search query or selecting "All" to view previous entries.'}
              </span>
            </div>
          ) : (
            <div className="divide-y divide-[#1D2128]">
              {filteredLogs.map((log) => {
                const isExpanded = expandedLogIds.has(log.id);
                const isCopied = copiedLogId === log.id;
                const hasDetails = Boolean(log.details || log.command);

                return (
                  <div
                    key={log.id}
                    className="p-3 hover:bg-[#11141A] transition-colors font-mono text-xs text-[#E8EAEE]"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {log.level === 'error' && (
                          <span className="bg-[#7F1D1D]/40 border border-[#DC2626]/40 text-[#EF4444] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" />
                            ERROR
                          </span>
                        )}
                        {log.level === 'warn' && (
                          <span className="bg-[#78350F]/40 border border-[#D97706]/40 text-[#F59E0B] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            WARN
                          </span>
                        )}
                        {log.level === 'info' && (
                          <span className="bg-[#0C4A6E]/40 border border-[#0284C7]/40 text-[#38BDF8] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                            INFO
                          </span>
                        )}

                        <span className="bg-[#1A1E24] text-[#9AA3AF] text-[10px] px-1.5 py-0.5 rounded border border-[#262B34]">
                          {log.source}
                        </span>

                        {log.modName && (
                          <span className="bg-[#2A1810] border border-[#EA580C]/40 text-[#FB923C] text-[10px] px-1.5 py-0.5 rounded font-semibold truncate max-w-[200px]">
                            {log.modName}
                          </span>
                        )}

                        <span className="text-[10.5px] text-[#6B7480]">
                          {new Date(log.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopySingleLog(log)}
                          className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1 rounded hover:bg-[#1D222A] transition-colors cursor-pointer"
                          title="Copy this log entry"
                        >
                          {isCopied ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3" />}
                        </button>

                        {hasDetails && (
                          <button
                            type="button"
                            onClick={() => toggleExpandLog(log.id)}
                            className="text-[#9AA3AF] hover:text-[#E8EAEE] text-[10.5px] flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-[#1D222A] transition-colors cursor-pointer"
                          >
                            <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11.5px] text-[#E8EAEE] font-sans font-medium break-words leading-relaxed">
                      {log.message}
                    </div>

                    {isExpanded && hasDetails && (
                      <div className="mt-2.5 pt-2 border-t border-[#1D2128] space-y-2">
                        {log.command && (
                          <div>
                            <span className="text-[10px] text-[#9AA3AF] uppercase tracking-wider block font-sans font-bold">
                              Invocation Command:
                            </span>
                            <div className="bg-[#121418] border border-[#23272E] rounded px-2.5 py-1.5 text-[10.5px] text-[#7DD3FC] mt-0.5 overflow-x-auto whitespace-pre">
                              {log.command}
                            </div>
                          </div>
                        )}

                        {log.details && (
                          <div>
                            <span className="text-[10px] text-[#9AA3AF] uppercase tracking-wider block font-sans font-bold">
                              Technical Trace / Output:
                            </span>
                            <pre className="bg-[#121418] border border-[#23272E] rounded p-2.5 text-[10.5px] text-[#FCA5A5] mt-0.5 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
                              {log.details}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DiagnosticLogSection.displayName = 'DiagnosticLogSection';
