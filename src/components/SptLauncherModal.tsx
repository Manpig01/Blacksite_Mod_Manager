import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Square,
  Terminal,
  RotateCw,
  Copy,
  Trash2,
} from 'lucide-react';
import { useSptProcessMonitor } from '../hooks/useSptProcessMonitor';
import { ShowToastFn } from '../hooks/useToastQueue';

interface SptLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
  sptDirectory: string;
  sptVersion: string;
  onShowToast: ShowToastFn;
  onServerStatusChange?: (running: boolean) => void;
}

export const SptLauncherModal: React.FC<SptLauncherModalProps> = ({
  isOpen,
  onClose,
  sptDirectory,
  sptVersion,
  onShowToast,
  onServerStatusChange,
}) => {
  const {
    isRunning,
    logs,
    serverStatus,
    clientStatus,
    launcherName,
    startSequence,
    stopServer,
    restartServer,
    clearLogs,
  } = useSptProcessMonitor(sptDirectory, sptVersion, onShowToast, onServerStatusChange);

  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    if (isOpen && serverStatus === 'idle') {
      startSequence();
    }
  }, [isOpen, serverStatus, startSequence]);

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    onShowToast('Logs Copied', 'Console log history copied to clipboard.', 'info');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-4xl h-[75vh] flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#23272E] flex items-center justify-between select-none">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0E1013] border border-[#23272E] flex items-center justify-center text-[#22C55E]">
              <Terminal className="w-4 h-4 text-[#22C55E]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#E8EAEE]">SPT Integrated Process Launcher</h2>
                <span className="text-[11px] font-mono text-[#6B7480]">v{sptVersion}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-[#9AA3AF]">
                <span>Server:</span>
                {serverStatus === 'starting' && (
                  <span className="text-[#F59E0B] font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-ping" />
                    Booting SPT.Server.exe...
                  </span>
                )}
                {serverStatus === 'ready' && (
                  <span className="text-[#22C55E] font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
                    Ready (127.0.0.1:6969)
                  </span>
                )}
                {serverStatus === 'stopped' && (
                  <span className="text-[#9AA3AF] font-medium">Stopped</span>
                )}
                {serverStatus === 'error' && (
                  <span className="text-[#DC2626] font-semibold">Launch Error</span>
                )}
                <span aria-hidden="true" className="text-[#3A3F4A]">·</span>
                <span>Client:</span>
                <span
                  className={
                    clientStatus === 'launched'
                      ? 'text-[#22C55E] font-semibold'
                      : clientStatus === 'waiting'
                      ? 'text-[#F97316] font-medium'
                      : 'text-[#6B7480]'
                  }
                >
                  {clientStatus === 'launched'
                    ? `Launched (${launcherName})`
                    : clientStatus === 'waiting'
                    ? 'Chaining after Server Ready...'
                    : 'Idle'}
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              disabled={logs.length === 0}
              className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] text-xs px-2.5 py-1.5 rounded-lg border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy terminal logs"
              type="button"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>

            <button
              onClick={clearLogs}
              disabled={logs.length === 0}
              className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#9AA3AF] hover:text-[#E8EAEE] text-xs px-2.5 py-1.5 rounded-lg border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Clear terminal output"
              type="button"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>

            {isRunning ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={restartServer}
                  className="bg-[#20252D] hover:bg-[#2A2F38] text-[#F59E0B] text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#F59E0B]/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Restart server process"
                  type="button"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Restart</span>
                </button>
                <button
                  onClick={stopServer}
                  className="bg-[#DC2626] hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  title="Terminate SPT.Server.exe process tree"
                  type="button"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop Server</span>
                </button>
              </div>
            ) : (
              <button
                onClick={startSequence}
                className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                title="Launch SPT.Server.exe then chain SPT.Launcher.exe"
                type="button"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Launch SPT</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded-lg transition-colors cursor-pointer ml-1"
              type="button"
              title="Close modal (Server stays running in background)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Terminal Live Stream View */}
        <div className="flex-1 bg-[#090B0E] p-4 font-mono text-xs overflow-y-auto space-y-1 select-text">
          {logs.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-[#6B7480]">
              <Terminal className="w-8 h-8 opacity-40 mb-2" />
              <p className="text-sm font-medium text-[#9AA3AF]">Terminal ready</p>
              <p className="text-xs">Click "Launch SPT" to spawn SPT.Server.exe and chain SPT.Launcher.exe.</p>
            </div>
          ) : (
            logs.map((log) => {
              const lower = log.text.toLowerCase();
              const isReady = lower.includes('ready') || lower.includes('happy hunting') || lower.includes('started successfully');
              const isError = log.level === 'error' || lower.includes('error') || lower.includes('exception');
              const isWarn = log.level === 'warn' || lower.includes('warn') || lower.includes('stopped');
              const isHighlight = lower.includes('spawning') || lower.includes('initializing') || lower.includes('starting');

              return (
                <div
                  key={log.id}
                  className={`leading-relaxed break-all ${
                    isReady
                      ? 'text-[#22C55E] font-medium'
                      : isError
                      ? 'text-[#EF4444]'
                      : isWarn
                      ? 'text-[#F59E0B]'
                      : isHighlight
                      ? 'text-[#38BDF8]'
                      : 'text-[#D1D5DB]'
                  }`}
                >
                  <span className="text-[#6B7480] select-none mr-2">[{log.timestamp}]</span>
                  <span>{log.text}</span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>

        {/* Footer Info Bar */}
        <div className="px-5 py-2.5 bg-[#121418] border-t border-[#23272E] flex items-center justify-between text-[11px] text-[#9AA3AF]">
          <div className="flex items-center gap-3">
            <span>
              Target Path: <code className="text-[#E8EAEE] font-mono">{sptDirectory}</code>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-[#EA580C]"
              />
              <span>Auto-scroll terminal</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
