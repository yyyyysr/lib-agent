import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * macOS 需要应用菜单承载复制粘贴等系统快捷键；Windows 隐藏原生菜单栏，
 * 功能入口放在应用内侧栏，两端可见功能保持一致。
 */
export function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const isDev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: '显示',
      submenu: [
        ...(isDev
          ? ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
