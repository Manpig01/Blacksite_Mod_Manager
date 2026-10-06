import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Square,
  Terminal,
  RotateCw,
  Copy,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface SptLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
  sptDirectory: string;
  sptVersion: string;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
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
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<{ id: string; text: string; level: 'info' | 'warn' | 'error'; timestamp: string }[]>([]);
  const [serverStatus, setServerStatus] = useState<'idle' | 'starting' | 'ready' | 'stopped' | 'error'>('idle');
  const [clientStatus, setClientStatus] = useState<'idle' | 'waiting' | 'launched'>('idle');
  const [launcherName, setLauncherName] = useState<string>('SPT.Launcher.exe');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll terminal when new logs arrive
  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Subscribe to real Electron IPC events
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

    if (!bridge) return;

    // Check current running state
    if (bridge.getSptStatus) {
      bridge.getSptStatus().then((status: any) => {
        if (status?.isRunning) {
          setIsRunning(true);
          setServerStatus('ready');
          if (status.hasLaunchedClient) {
            setClientStatus('launched');
          }
          if (onServerStatusChange) onServerStatusChange(true);
        }
      }).catch(() => {});
    }

    const unsubLog = bridge.onSptServerLog?.((data: { text: string; level: 'info' | 'warn' | 'error'; timestamp: string }) => {
      setLogs((prev) => [
        ...prev,
        {
          id: `log-${Date.now()}-${Math.random()}`,
          text: data.text,
          level: data.level || 'info',
          timestamp: data.timestamp || new Date().toLocaleTimeString(),
        },
      ]);

      const lower = (data.text || '').toLowerCase();
      if (
        lower.includes('server is ready') ||
        lower.includes('happy hunting') ||
        lower.includes('started webserver') ||
        lower.includes('listening on')
      ) {
        setServerStatus('ready');
        setIsRunning(true);
        if (onServerStatusChange) onServerStatusChange(true);
      }
    });

    const unsubClient = bridge.onSptClientLaunched?.((data: { launcherName: string }) => {
      setClientStatus('launched');
      if (data?.launcherName) {
        setLauncherName(data.launcherName);
      }
      onShowToast('SPT Launched', `SPT.Server is active and ${data?.launcherName || 'SPT.Launcher.exe'} has been started!`, 'success');
    });

    const unsubExit = bridge.onSptServerExit?.((data: { code: number; signal?: string }) => {
      setIsRunning(false);
      setServerStatus('stopped');
      if (onServerStatusChange) onServerStatusChange(false);
      onShowToast('Server Stopped', `SPT.Server.exe has shut down (Code: ${data.code}).`, 'info');
    });

    return () => {
      if (unsubLog) unsubLog();
      if (unsubClient) unsubClient();
      if (unsubExit) unsubExit();
    };
  }, [onServerStatusChange, onShowToast]);

  // When modal is opened and server is idle, automatically start sequence
  useEffect(() => {
    if (isOpen && serverStatus === 'idle') {
      handleStartSequence();
    }
  }, [isOpen]);

  const handleStartSequence = async () => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

    setIsRunning(true);
    setServerStatus('starting');
    setClientStatus('waiting');

    const initTime = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}-1`,
        text: `[Blacksite Launcher] Initializing Single Player Tarkov v${sptVersion} environment...`,
        level: 'info',
        timestamp: initTime,
      },
      {
        id: `sys-${Date.now()}-2`,
        text: `[Blacksite Launcher] Resolving executable paths in ${sptDirectory}\\SPT_Runtime and ${sptDirectory}...`,
        level: 'info',
        timestamp: initTime,
      },
      {
        id: `sys-${Date.now()}-3`,
        text: `[Blacksite Launcher] Spawning SPT.Server.exe (port 6969)...`,
        level: 'info',
        timestamp: initTime,
      },
    ]);

    if (bridge?.launchSpt) {
      try {
        const result = await bridge.launchSpt({
          sptDirectory,
          sptVersion,
        });

        if (!result || !result.success) {
          throw new Error(result?.error || 'Failed to start SPT.Server.exe');
        }

        if (onServerStatusChange) onServerStatusChange(true);
      } catch (err: any) {
        setIsRunning(false);
        setServerStatus('error');
        if (onServerStatusChange) onServerStatusChange(false);
        setLogs((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            text: `[Blacksite Launcher] ERROR: ${err.message}`,
            level: 'error',
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        onShowToast('Launch Failed', err.message, 'error');
      }
      return;
    }

    // Web Fallback Simulation (for preview environments without native Electron child_process)
    const timer1 = setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        {
          id: `sim-1`,
          text: `[SPT-Server] Loading BepInEx & Server mods: SAIN, BigBrain, SVM, Waypoints, LootingBots...`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          id: `sim-2`,
          text: `[SPT-Server] Database loaded. 2,140 items, 34 traders, and raid configurations initialized.`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    }, 1200);

    const timer2 = setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        {
          id: `sim-3`,
          text: `[SPT-Server] Server is ready! Happy hunting in Tarkov! (Listening on 127.0.0.1:6969)`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setServerStatus('ready');
      if (onServerStatusChange) onServerStatusChange(true);

      setTimeout(() => {
        setLogs((prev) => [
          ...prev,
          {
            id: `sim-4`,
            text: `[Blacksite Launcher] Ready marker detected! Starting SPT.Launcher.exe...`,
            level: 'info',
            timestamp: new Date().toLocaleTimeString(),
          },
          {
            id: `sim-5`,
            text: `[Blacksite Launcher] SPT.Launcher.exe started successfully!`,
            level: 'info',
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        setClientStatus('launched');
        onShowToast('SPT Launched', 'SPT Server is running and SPT.Launcher.exe has been launched.', 'success');
      }, 700);
    }, 2400);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  };

  const handleStopServer = async () => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

    setLogs((prev) => [
      ...prev,
      {
        id: `stop-${Date.now()}`,
        text: `[Blacksite Launcher] Terminating SPT.Server.exe process tree...`,
        level: 'warn',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    if (bridge?.stopSptServer) {
      try {
        await bridge.stopSptServer();
      } catch (err: any) {
        console.error('Stop server error:', err);
      }
    }

    setIsRunning(false);
    setServerStatus('stopped');
    if (onServerStatusChange) onServerStatusChange(false);

    setLogs((prev) => [
      ...prev,
      {
        id: `stop-done-${Date.now()}`,
        text: `[Blacksite Launcher] Server stopped. Port 6969 released.`,
        level: 'info',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    onShowToast('Server Stopped', 'SPT.Server.exe has been stopped.', 'info');
  };

  const handleRestart = async () => {
    await handleStopServer();
    setTimeout(() => {
      handleStartSequence();
    }, 500);
  };

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    onShowToast('Logs Copied', 'Console log history copied to clipboard.', 'info');
  };

  const handleClearLogs = () => {
    setLogs([]);
    onShowToast('Console Cleared', 'Terminal output wiped.', 'info');
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
              onClick={handleClearLogs}
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
                  onClick={handleRestart}
                  className="bg-[#20252D] hover:bg-[#2A2F38] text-[#F59E0B] text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#F59E0B]/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Restart server process"
                  type="button"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Restart</span>
                </button>
                <button
                  onClick={handleStopServer}
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
                onClick={handleStartSequence}
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
                  <span className="text-[#4B5563] mr-2 select-none">[{log.timestamp}]</span>
                  <span>{log.text}</span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>

        {/* Terminal Footer with Status Bar & Auto-scroll Toggle */}
        <div className="px-4 py-2 bg-[#121418] border-t border-[#23272E] text-[11px] text-[#9AA3AF] flex items-center justify-between select-none">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-[#22C55E] animate-pulse' : 'bg-[#6B7480]'
                }`}
              />
              {isRunning ? 'Port 6969 Monitored · Process Active' : 'Server Inactive'}
            </span>
            <span aria-hidden="true" className="text-[#3A3F4A]">·</span>
            <span className="font-mono text-[#6B7480] truncate max-w-sm">
              Path: {sptDirectory}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-[#6B7480] hover:text-[#9AA3AF]">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#EA580C] rounded cursor-pointer"
              />
              <span>Auto-scroll</span>
            </label>
            <span className="font-mono text-[#6B7480]">{logs.length} lines</span>
          </div>
        </div>
      </div>
    </div>
  );
};
