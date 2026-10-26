import { DesktopBridgeAPI } from '../types';

/**
 * Strongly-typed wrapper for accessing the Electron Desktop IPC Bridge.
 * Safely returns null when running inside a standard web browser.
 */
export function getDesktopBridge(): DesktopBridgeAPI | null {
  if (typeof window !== 'undefined' && window.desktopBridge) {
    return window.desktopBridge;
  }
  return null;
}

/**
 * Returns true when running inside the packaged or development Electron desktop environment.
 */
export function isDesktopEnvironment(): boolean {
  const bridge = getDesktopBridge();
  return Boolean(bridge?.isElectron);
}

/**
 * Returns the logical CPU core count exposed by the desktop bridge, or a sensible fallback.
 */
export function getDetectedCpuCores(fallback = 8): number {
  const bridge = getDesktopBridge();
  if (bridge?.cpuCount && Number.isFinite(Number(bridge.cpuCount))) {
    return Math.max(2, Number(bridge.cpuCount));
  }
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return Math.max(2, navigator.hardwareConcurrency);
  }
  return fallback;
}
