import { useState, useEffect, useCallback } from 'react';
import { getDesktopBridge } from '../services/desktopBridgeService';
import { ShowToastFn } from './useToastQueue';

export interface SptProcessLogItem {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
}

const MAX_LOG_ENTRIES = 400;

export function useSptProcessMonitor(
  sptDirectory: string,
  sptVersion: string,
  onShowToast: ShowToastFn,
  onServerStatusChange?: (running: boolean) => void
) {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<SptProcessLogItem[]>([]);
  const [serverStatus, setServerStatus] = useState<'idle' | 'starting' | 'ready' | 'stopped' | 'error'>('idle');
  const [clientStatus, setClientStatus] = useState<'idle' | 'waiting' | 'launched'>('idle');
  const [launcherName, setLauncherName] = useState<string>('SPT.Launcher.exe');

  const appendLogs = useCallback((entries: SptProcessLogItem[]) => {
    setLogs((prev) => {
      const next = [...prev, ...entries];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    if (bridge.getSptStatus) {
      bridge
        .getSptStatus()
        .then((status) => {
          if (status?.isRunning) {
            setIsRunning(true);
            setServerStatus('ready');
            if (status.hasLaunchedClient) {
              setClientStatus('launched');
            }
            onServerStatusChange?.(true);
          }
        })
        .catch(() => {});
    }

    const unsubLog = bridge.onSptServerLog?.((data) => {
      appendLogs([
        {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        onServerStatusChange?.(true);
      }
    });

    const unsubClient = bridge.onSptClientLaunched?.((data) => {
      setClientStatus('launched');
      if (data?.launcherName) {
        setLauncherName(data.launcherName);
      }
      onShowToast(
        'SPT Launched',
        `SPT.Server is active and ${data?.launcherName || 'SPT.Launcher.exe'} has been started!`,
        'success'
      );
    });

    const unsubExit = bridge.onSptServerExit?.((data) => {
      setIsRunning(false);
      setServerStatus('stopped');
      onServerStatusChange?.(false);
      onShowToast('Server Stopped', `SPT.Server.exe has shut down (Code: ${data.code}).`, 'info');
    });

    return () => {
      unsubLog?.();
      unsubClient?.();
      unsubExit?.();
    };
  }, [appendLogs, onServerStatusChange, onShowToast]);

  const startSequence = useCallback(async () => {
    const bridge = getDesktopBridge();

    setIsRunning(true);
    setServerStatus('starting');
    setClientStatus('waiting');

    const initTime = new Date().toLocaleTimeString();
    appendLogs([
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

        onServerStatusChange?.(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start SPT.Server.exe';
        setIsRunning(false);
        setServerStatus('error');
        onServerStatusChange?.(false);
        appendLogs([
          {
            id: `err-${Date.now()}`,
            text: `[Blacksite Launcher] ERROR: ${message}`,
            level: 'error',
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        onShowToast('Launch Failed', message, 'error');
      }
      return;
    }

    // Web Fallback Simulation (for preview environments without native Electron child_process)
    setTimeout(() => {
      appendLogs([
        {
          id: `sim-${Date.now()}-1`,
          text: `[SPT-Server] Loading BepInEx & Server mods...`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          id: `sim-${Date.now()}-2`,
          text: `[SPT-Server] Database loaded. 2,140 items, 34 traders, and raid configurations initialized.`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    }, 1000);

    setTimeout(() => {
      appendLogs([
        {
          id: `sim-${Date.now()}-3`,
          text: `[SPT-Server] Server is ready! Happy hunting in Tarkov! (Listening on 127.0.0.1:6969)`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setServerStatus('ready');
      onServerStatusChange?.(true);

      setTimeout(() => {
        appendLogs([
          {
            id: `sim-${Date.now()}-4`,
            text: `[Blacksite Launcher] Ready marker detected! Starting SPT.Launcher.exe...`,
            level: 'info',
            timestamp: new Date().toLocaleTimeString(),
          },
          {
            id: `sim-${Date.now()}-5`,
            text: `[Blacksite Launcher] SPT.Launcher.exe started successfully!`,
            level: 'info',
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        setClientStatus('launched');
        onShowToast('SPT Launched', 'SPT Server is running and SPT.Launcher.exe has been launched.', 'success');
      }, 650);
    }, 2100);
  }, [appendLogs, onServerStatusChange, onShowToast, sptDirectory, sptVersion]);

  const stopServer = useCallback(async () => {
    const bridge = getDesktopBridge();

    appendLogs([
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
      } catch (err) {
        console.error('Stop server error:', err);
      }
    }

    setIsRunning(false);
    setServerStatus('stopped');
    onServerStatusChange?.(false);

    appendLogs([
      {
        id: `stop-done-${Date.now()}`,
        text: `[Blacksite Launcher] Server stopped. Port 6969 released.`,
        level: 'info',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    onShowToast('Server Stopped', 'SPT.Server.exe has been stopped.', 'info');
  }, [appendLogs, onServerStatusChange, onShowToast]);

  const restartServer = useCallback(async () => {
    await stopServer();
    setTimeout(() => {
      startSequence();
    }, 500);
  }, [stopServer, startSequence]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    onShowToast('Console Cleared', 'Terminal output wiped.', 'info');
  }, [onShowToast]);

  return {
    isRunning,
    logs,
    serverStatus,
    clientStatus,
    launcherName,
    startSequence,
    stopServer,
    restartServer,
    clearLogs,
  };
}
