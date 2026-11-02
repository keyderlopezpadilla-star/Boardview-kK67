/** Native shells (Electron desktop / Capacitor Android) expose small, optional hooks. */

export interface NativeFile {
  name: string;
  data: Uint8Array;
}

declare global {
  interface Window {
    kk67?: { platform: 'desktop'; onOpenFiles(cb: (files: NativeFile[]) => void): void };
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

export const isDesktopShell = () => !!window.kk67;
export const isAndroidShell = () => !!window.Capacitor?.isNativePlatform?.();

/** Offline support + installability for the plain web build (Chromebook, desktop browsers). */
export function registerServiceWorker(): void {
  if (isDesktopShell() || isAndroidShell() || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  });
}
