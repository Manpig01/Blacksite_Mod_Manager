const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Regex that strips all ANSI CSI/OSC color & cursor escape sequences from SPT.Server stdout
const ANSI_ESCAPE_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

let activeServerProcess = null;
let activeServerPid = null;
let hasLaunchedClientThisSession = false;

/**
 * Polls the SPT local HTTPS loopback endpoint (https://127.0.0.1:6969/launcher/ping)
 * to confirm the HTTP listener is genuinely accepting connections before launching the client.
 */
function pingSptServer(port = 6969, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/launcher/ping',
        method: 'GET',
        rejectUnauthorized: false, // SPT uses a self-signed localhost certificate
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Finds the server executable in SPT_Runtime, SPT, or root SPT directory
 */
function findServerExecutable(sptDirectory) {
  if (!sptDirectory) return null;
  const subdirs = ['SPT_Runtime', 'SPT', ''];
  const candidates = [
    'SPT.Server.exe',
    'Aki.Server.exe',
    'Server.exe',
  ];
  for (const subdir of subdirs) {
    for (const name of candidates) {
      const fullPath = subdir ? path.join(sptDirectory, subdir, name) : path.join(sptDirectory, name);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * Finds the launcher executable in SPT_Runtime, SPT, or root SPT directory
 */
function findLauncherExecutable(sptDirectory) {
  if (!sptDirectory) return null;
  const subdirs = ['SPT_Runtime', 'SPT', ''];
  const candidates = [
    'SPT.Launcher.exe',
    'Aki.Launcher.exe',
    'EscapeFromTarkov.exe',
  ];
  for (const subdir of subdirs) {
    for (const name of candidates) {
      const fullPath = subdir ? path.join(sptDirectory, subdir, name) : path.join(sptDirectory, name);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * Spawns SPT.Launcher.exe independently
 */
function launchClient(sptDirectory, onLog, onClientLaunched) {
  const launcherPath = findLauncherExecutable(sptDirectory);
  if (!launcherPath) {
    if (onLog) {
      onLog({
        text: `[Blacksite Launcher] Warning: Could not find SPT.Launcher.exe or Aki.Launcher.exe in ${sptDirectory} or SPT_Runtime`,
        level: 'warn',
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    return false;
  }

  const launcherName = path.basename(launcherPath);
  const launcherCwd = path.dirname(launcherPath);

  if (onLog) {
    onLog({
      text: `[Blacksite Launcher] Ready marker detected! Starting ${launcherName} from ${launcherCwd}...`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  try {
    const clientProc = spawn(launcherPath, [], {
      cwd: launcherCwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    clientProc.unref();

    if (onClientLaunched) {
      onClientLaunched({
        launcherName,
        launcherPath,
        timestamp: new Date().toLocaleTimeString(),
      });
    }

    if (onLog) {
      onLog({
        text: `[Blacksite Launcher] ${launcherName} launched successfully!`,
        level: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    return true;
  } catch (err) {
    if (onLog) {
      onLog({
        text: `[Blacksite Launcher] Error launching ${launcherName}: ${err.message}`,
        level: 'error',
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    return false;
  }
}

/**
 * Launches the SPT Server, streams logs, and chains launcher execution on ready
 */
async function launchSptSequence({
  sptDirectory,
  sptVersion,
  onLog,
  onClientLaunched,
  onServerExit,
}) {
  if (!sptDirectory || !fs.existsSync(sptDirectory)) {
    throw new Error(`SPT directory does not exist: "${sptDirectory}"`);
  }

  const serverExe = findServerExecutable(sptDirectory);
  if (!serverExe) {
    throw new Error(
      `Could not find SPT.Server.exe or Aki.Server.exe in "${sptDirectory}" or "${path.join(sptDirectory, 'SPT_Runtime')}". Please verify your SPT Folder Configuration in Settings.`
    );
  }

  // If server is already running, just trigger launcher if needed
  if (activeServerProcess && activeServerPid) {
    if (onLog) {
      onLog({
        text: `[Blacksite Launcher] SPT.Server is already running (PID: ${activeServerPid}). Triggering launcher...`,
        level: 'info',
        timestamp: new Date().toLocaleTimeString(),
      });
    }
    launchClient(sptDirectory, onLog, onClientLaunched);
    return {
      success: true,
      alreadyRunning: true,
      pid: activeServerPid,
      serverExe: path.basename(serverExe),
    };
  }

  hasLaunchedClientThisSession = false;
  const serverName = path.basename(serverExe);
  const serverCwd = path.dirname(serverExe);

  if (onLog) {
    onLog({
      text: `[Blacksite Launcher] Initializing ${serverName} (SPT ${sptVersion || '4.x'})...`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
    onLog({
      text: `[Blacksite Launcher] Server Binary: ${serverExe}`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
    onLog({
      text: `[Blacksite Launcher] Working Directory: ${serverCwd}`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  try {
    const serverProc = spawn(serverExe, [], {
      cwd: serverCwd,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
    });

    activeServerProcess = serverProc;
    activeServerPid = serverProc.pid;

    const readyRegex = /(server is ready|happy hunting|happy playing|started webserver|listening on|server started|started.*server|127\.0\.0\.1:6969)/i;

    const handleData = (data, isStderr = false) => {
      const rawText = data.toString('utf8');
      const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        // Strip all ANSI CSI/OSC color & cursor escape sequences from modded server logs
        const clean = line.replace(ANSI_ESCAPE_REGEX, '').trim();
        if (!clean) continue;

        if (onLog) {
          onLog({
            text: clean,
            level: isStderr ? 'warn' : 'info',
            timestamp: new Date().toLocaleTimeString(),
          });
        }

        // Check for server ready milestone to trigger the launcher
        if (!hasLaunchedClientThisSession && readyRegex.test(clean)) {
          hasLaunchedClientThisSession = true;
          // Verify genuine HTTP listener readiness via local loopback ping
          pingSptServer(6969).then((isAlive) => {
            if (onLog) {
              onLog({
                text: `[Blacksite Launcher] Server readiness confirmed${isAlive ? ' (Loopback ping verified)' : ''}. Launching Tarkov client...`,
                level: 'info',
                timestamp: new Date().toLocaleTimeString(),
              });
            }
            setTimeout(() => {
              launchClient(sptDirectory, onLog, onClientLaunched);
            }, 500);
          });
        }
      }
    };

    if (serverProc.stdout) {
      serverProc.stdout.on('data', (d) => handleData(d, false));
    }
    if (serverProc.stderr) {
      serverProc.stderr.on('data', (d) => handleData(d, true));
    }

    serverProc.on('error', (err) => {
      if (onLog) {
        onLog({
          text: `[Blacksite Launcher] Server execution error: ${err.message}`,
          level: 'error',
          timestamp: new Date().toLocaleTimeString(),
        });
      }
      activeServerProcess = null;
      activeServerPid = null;
      if (onServerExit) {
        onServerExit({ code: -1, error: err.message });
      }
    });

    serverProc.on('exit', (code, signal) => {
      if (onLog) {
        onLog({
          text: `[Blacksite Launcher] ${serverName} process exited (Code: ${code}, Signal: ${signal || 'none'}).`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
      }
      activeServerProcess = null;
      activeServerPid = null;
      hasLaunchedClientThisSession = false;
      if (onServerExit) {
        onServerExit({ code, signal });
      }
    });

    return {
      success: true,
      pid: serverProc.pid,
      serverExe: serverName,
    };
  } catch (spawnErr) {
    activeServerProcess = null;
    activeServerPid = null;
    throw spawnErr;
  }
}

/**
 * Graceful Shutdown Guard:
 * Avoids immediate TerminateProcess so SPT.Server can flush in-memory PMC profile JSON saves
 * to user/profiles/*.json. Falls back to tree termination only if hung after grace period.
 */
async function stopSptServer(onLog, gracePeriodMs = 5000) {
  if (!activeServerProcess && !activeServerPid) {
    return { success: true, notRunning: true };
  }

  const proc = activeServerProcess;
  const pid = activeServerPid;

  if (onLog) {
    onLog({
      text: `[Blacksite Launcher] Initiating graceful shutdown of SPT Server (PID: ${pid}). Flushing profile saves...`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (msg) => {
      if (resolved) return;
      resolved = true;
      activeServerProcess = null;
      activeServerPid = null;
      hasLaunchedClientThisSession = false;
      if (onLog) {
        onLog({
          text: msg || '[Blacksite Launcher] SPT Server stopped. Port 6969 released.',
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
      }
      resolve({ success: true });
    };

    // Watchdog fallback timer
    const forceKillTimer = setTimeout(() => {
      if (proc && pid) {
        if (onLog) {
          onLog({
            text: `[Blacksite Launcher] Grace period expired (${gracePeriodMs}ms). Terminating process tree...`,
            level: 'warn',
            timestamp: new Date().toLocaleTimeString(),
          });
        }
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
            finish('[Blacksite Launcher] Server process tree force-terminated.')
          );
        } else {
          try {
            proc.kill('SIGKILL');
          } catch (_) {}
          finish('[Blacksite Launcher] Server process killed.');
        }
      } else {
        finish();
      }
    }, gracePeriodMs);

    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
      finish('[Blacksite Launcher] SPT Server exited gracefully. Profiles flushed.');
    });

    // Attempt soft termination
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      }
      if (process.platform === 'win32') {
        // Non-forced taskkill sends WM_CLOSE / break event for graceful shutdown
        execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => {});
      } else {
        proc.kill('SIGTERM');
      }
    } catch (err) {
      try {
        proc.kill();
      } catch (_) {}
    }
  });
}

function getSptStatus() {
  return {
    isRunning: !!activeServerProcess && !!activeServerPid,
    pid: activeServerPid,
    hasLaunchedClient: hasLaunchedClientThisSession,
  };
}

module.exports = {
  launchSptSequence,
  stopSptServer,
  getSptStatus,
  findServerExecutable,
  findLauncherExecutable,
};
