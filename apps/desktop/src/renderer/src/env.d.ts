import type { DesktopBridge } from '@yys/shared';

declare global {
  interface Window {
    yys: DesktopBridge;
  }
}
