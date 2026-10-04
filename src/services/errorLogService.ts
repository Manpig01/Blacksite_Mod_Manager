export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  source: 'Installer' | 'ArchiveExtractor' | 'DependencyResolver' | 'Network' | 'DiskRouter' | 'System';
  modName?: string;
  message: string;
  details?: string;
  command?: string;
}

const ERROR_LOGS_KEY = 'blacksite_error_logs_v1';
const MAX_LOGS = 100;

class ErrorLogService {
  private logs: ErrorLogEntry[] = [];
  private listeners: Set<(logs: ErrorLogEntry[]) => void> = new Set();

  constructor() {
    this.logs = this.loadLogs();
  }

  private loadLogs(): ErrorLogEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(ERROR_LOGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveLogs(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(ERROR_LOGS_KEY, JSON.stringify(this.logs));
    } catch {
      // ignore
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener([...this.logs]);
      } catch (err) {
        console.error('Error log listener error:', err);
      }
    }
  }

  subscribe(listener: (logs: ErrorLogEntry[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.logs]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLogs(): ErrorLogEntry[] {
    return [...this.logs];
  }

  log(
    level: 'error' | 'warn' | 'info',
    source: ErrorLogEntry['source'],
    message: string,
    details?: string,
    modName?: string,
    command?: string
  ): ErrorLogEntry {
    const entry: ErrorLogEntry = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      modName,
      message,
      details,
      command,
    };

    this.logs = [entry, ...this.logs].slice(0, MAX_LOGS);
    this.saveLogs();
    return entry;
  }

  logError(source: ErrorLogEntry['source'], message: string, details?: string, modName?: string, command?: string): ErrorLogEntry {
    return this.log('error', source, message, details, modName, command);
  }

  logWarn(source: ErrorLogEntry['source'], message: string, details?: string, modName?: string): ErrorLogEntry {
    return this.log('warn', source, message, details, modName);
  }

  logInfo(source: ErrorLogEntry['source'], message: string, details?: string, modName?: string): ErrorLogEntry {
    return this.log('info', source, message, details, modName);
  }

  clearLogs(): void {
    this.logs = [];
    this.saveLogs();
  }

  exportLogsAsText(): string {
    return this.logs
      .map((l) => {
        let text = `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}]${l.modName ? ` [${l.modName}]` : ''}: ${l.message}`;
        if (l.command) text += `\nCommand: ${l.command}`;
        if (l.details) text += `\nDetails:\n${l.details}`;
        return text + '\n' + '-'.repeat(70);
      })
      .join('\n\n');
  }

  exportLogsAsJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const errorLogService = new ErrorLogService();
