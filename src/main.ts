import { app, BrowserWindow, screen, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DISPLAY_NAME } from './shared/app-info';
import { registerIpc } from './main/ipc';

const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

// 开发模式需要 Vite HMR(内联脚本、ws),生产模式收紧。
const buildCsp = (dev: boolean) =>
  [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    dev
      ? "connect-src 'self' ws://localhost:* http://localhost:*"
      : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

/** 初始窗口大小:宽占屏幕可用区域的 85%、高占 95%,不超过 1440×1100,也不小于最小尺寸。 */
const initialSize = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(960, Math.min(1440, Math.round(width * 0.85))),
    height: Math.max(640, Math.min(1100, Math.round(height * 0.95))),
  };
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    ...initialSize(),
    minWidth: 960,
    minHeight: 640,
    title: APP_DISPLAY_NAME,
    // 隐藏标题栏,让红绿灯按钮融进渐变背景。
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    backgroundColor: '#0a4a35',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 禁止渲染进程打开新窗口或跳转到外部地址。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)],
      },
    });
  });

  // 打包后的应用图标来自 .icns;开发模式下 Dock 里还是 Electron 默认图标,这里手动换掉。
  if (isDev && process.platform === 'darwin') {
    const icon = path.join(app.getAppPath(), 'build', 'icon.png');
    if (fs.existsSync(icon)) app.dock?.setIcon(icon);
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
