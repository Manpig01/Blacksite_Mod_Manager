import React, { useState, useEffect } from 'react';
import { X, Play, Square, Terminal, CheckCircle2, AlertCircle, Copy } from 'lucide-react';

interface SptLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
  sptVersion: string;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SptLauncherModal: React.FC<SptLauncherModalProps> = ({
  isOpen,
  onClose,
  sptVersion,
  onShowToast,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [serverStatus, setServerStatus] = useState<'idle' | 'starting' | 'ready' | 'stopped'>('idle');
  const [clientStatus, setClientStatus] = useState<'idle' | 'launched'>('idle');

  useEffect(() => {
    if (isOpen && serverStatus === 'idle') {
      startServerSequence();
    }
  }, [isOpen]);

  const startServerSequence = () => {
    setIsRunning(true);
    setServerStatus('starting');
    setClientStatus('idle');
    setLogs([
      `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Initializing SPT v${sptVersion} environment...`,
      `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Running startup temp sweep (bs-staging-*, bs-extract-* cleaned)...`,
      `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Starting SPT.Server.exe on 127.0.0.1:6969...`,
    ]);

    // Simulate server log progression
    const timer1 = setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SPT-Server] Loading server mods: BigBrain, SAIN, SVM...`,
        `[${new Date().toLocaleTimeString()}] [SPT-Server] Database loaded. 1,940 items, 32 traders indexed.`,
      ]);
    }, 1200);

    const timer2 = setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [SPT-Server] Server is ready! Happy hunting in Tarkov!`,
      ]);
      setServerStatus('ready');

      // Now chain client launch after ready marker is caught
      setTimeout(() => {
        setLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Marker "Server is ready" detected!`,
          `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Chaining client launch: EscapeFromTarkov.exe (with BepInEx)...`,
          `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Game client launched successfully!`,
        ]);
        setClientStatus('launched');
        onShowToast('SPT Launched', 'SPT Server is running and game client was started.', 'success');
      }, 800);
    }, 2500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  };

  const handleStop = () => {
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Stop requested. Terminating SPT.Server.exe process.`,
      `[${new Date().toLocaleTimeString()}] [Blacksite Launcher] Server stopped. Double-launch guard reset.`,
    ]);
    setIsRunning(false);
    setServerStatus('stopped');
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    onShowToast('Logs Copied', 'Server console tail copied to clipboard.', 'info');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#23272E] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-[#22C55E]" />
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE]">SPT Integrated Process Launcher</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs">
                <span className="text-[#9AA3AF]">Server: </span>
                {serverStatus === 'starting' && (
                  <span className="text-[#F59E0B] font-semibold animate-pulse">Starting...</span>
                )}
                {serverStatus === 'ready' && (
                  <span className="text-[#22C55E] font-semibold">Running & Ready (127.0.0.1:6969)</span>
                )}
                {serverStatus === 'stopped' && (
                  <span className="text-[#DC2626] font-semibold">Stopped</span>
                )}
                <span className="text-[#6B7480]">·</span>
                <span className="text-[#9AA3AF]">Client: </span>
                <span className={clientStatus === 'launched' ? 'text-[#22C55E] font-semibold' : 'text-[#6B7480]'}>
                  {clientStatus === 'launched' ? 'Active' : 'Waiting on server'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs px-2.5 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy server console logs"
              type="button"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>

            {isRunning ? (
              <button
                onClick={handleStop}
                className="bg-[#DC2626] hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                type="button"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop Server</span>
              </button>
            ) : (
              <button
                onClick={startServerSequence}
                className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                type="button"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Start Server</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded transition-colors cursor-pointer ml-1"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Console view */}
        <div className="flex-1 bg-[#0A0C0E] p-4 font-mono text-xs overflow-y-auto space-y-1 select-text">
          {logs.map((log, idx) => (
            <div
              key={idx}
              className={`${
                log.includes('ready') || log.includes('successfully')
                  ? 'text-[#22C55E]'
                  : log.includes('Starting') || log.includes('Initializing')
                  ? 'text-[#38BDF8]'
                  : log.includes('stopped') || log.includes('Terminating')
                  ? 'text-[#F87171]'
                  : 'text-[#9AA3AF]'
              }`}
            >
              {log}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#121418] border-t border-[#23272E] text-[11px] text-[#6B7480] flex items-center justify-between">
          <span>Double-launch guard active · Monitored port: 6969</span>
          <span>Target SPT: v{sptVersion}</span>
        </div>
      </div>
    </div>
  );
};
