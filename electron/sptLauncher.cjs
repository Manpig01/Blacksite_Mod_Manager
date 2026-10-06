const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let activeServerProcess = null;
let activeServerPid = null;
let hasLaunchedClientThisSession = false;

/**
 * Finds the server executable in SPT_Runtime or root SPT directory
 */
function findServerExecutable(sptDirectory) {
  if (!sptDirectory) return null;
  const subdirs = ['SPT_Runtime', ''];
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
 * Finds the launcher executable in SPT_Runtime or root SPT directory
 */
function findLauncherExecutable(sptDirectory) {
  if (!sptDirectory) return null;
  const subdirs = ['SPT_Runtime', ''];
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

    const readyRegex = /(server is ready|happy hunting|started webserver|listening on|server started|started.*server)/i;

    const handleData = (data, isStderr = false) => {
      const rawText = data.toString('utf8');
      const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        const clean = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ''); // Strip ANSI escape codes

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
          // Small delay so server finishes socket bind
          setTimeout(() => {
            launchClient(sptDirectory, onLog, onClientLaunched);
          }, 600);
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
 * Forcefully terminates the active SPT Server process tree
 */
async function stopSptServer(onLog) {
  if (!activeServerProcess && !activeServerPid) {
    return { success: true, notRunning: true };
  }

  const pid = activeServerPid;
  if (onLog) {
    onLog({
      text: `[Blacksite Launcher] Terminating SPT Server process (PID: ${pid})...`,
      level: 'info',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return new Promise((resolve) => {
    if (process.platform === 'win32' && pid) {
      // Windows taskkill terminates the entire child process tree cleanly
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        if (err) {
          console.warn('taskkill notice:', err.message);
        }
        activeServerProcess = null;
        activeServerPid = null;
        hasLaunchedClientThisSession = false;
        if (onLog) {
          onLog({
            text: `[Blacksite Launcher] Server process tree terminated. Port 6969 released.`,
            level: 'info',
            timestamp: new Date().toLocaleTimeString(),
          });
        }
        resolve({ success: true });
      });
    } else {
      if (activeServerProcess) {
        try {
          activeServerProcess.kill('SIGKILL');
        } catch {}
      }
      activeServerProcess = null;
      activeServerPid = null;
      hasLaunchedClientThisSession = false;
      if (onLog) {
        onLog({
          text: `[Blacksite Launcher] Server process terminated.`,
          level: 'info',
          timestamp: new Date().toLocaleTimeString(),
        });
      }
      resolve({ success: true });
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
