/// <reference types="vite/client" />

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

interface Window {
  desktopBridge?: import('./types').DesktopBridgeAPI;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<{ name: string }>;
}

