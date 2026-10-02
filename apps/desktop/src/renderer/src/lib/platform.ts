/**
 * 平台差异只允许出现在这个文件：窗口控制区留白、快捷键符号。
 * 其余页面与样式两端完全一致。
 */
export const platform = window.yys.platform;
export const isMac = platform === 'darwin';

export function initPlatform(): void {
  document.documentElement.classList.add(`platform-${platform}`);
}

/** 主修饰键：macOS 为 ⌘，其他平台为 Ctrl */
export const isModKey = (event: KeyboardEvent | React.KeyboardEvent): boolean => (isMac ? event.metaKey : event.ctrlKey);

export function formatShortcut(key: string, options: { shift?: boolean } = {}): string {
  if (isMac) return `${options.shift ? '⇧' : ''}⌘${key.toUpperCase()}`;
  return `Ctrl+${options.shift ? 'Shift+' : ''}${key.toUpperCase()}`;
}
