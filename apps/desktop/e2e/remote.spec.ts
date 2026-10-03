import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** 连接团队服务器：本地启动打包后的服务器，在界面上确认证书指纹、登录、读取服务器数据，再切回本机 */

const root = join(import.meta.dirname, '..', '..', '..');
const serverBundle = join(root, 'apps', 'server', 'dist', 'server.mjs');
const shots = join(import.meta.dirname, '..', 'e2e-results', 'screenshots', process.platform);
const ADMIN_PASSWORD = 'Remote-Init-Pass-1';

let serverDir: string;
let userDataDir: string;
let server: ChildProcess;
let serverUrl: string;
let fingerprint: string;
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

test.describe.configure({ mode: 'serial' });

const shot = (name: string) => page.screenshot({ path: join(shots, `${name}.png`) });
const dialog = () => page.getByRole('dialog');

test.beforeAll(async () => {
  if (!existsSync(serverBundle))
    execFileSync('pnpm', ['--filter', '@yys/server', 'build'], { cwd: root, stdio: 'ignore' });
  serverDir = mkdtempSync(join(tmpdir(), 'yys-e2e-server-'));
  mkdirSync(join(serverDir, 'tls'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=yiyeshuzhan-e2e',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      join(serverDir, 'tls', 'server.key'),
      '-out',
      join(serverDir, 'tls', 'server.crt'),
    ],
    { stdio: 'ignore' },
  );

  server = spawn(process.execPath, [serverBundle], {
    env: {
      ...process.env,
      YYS_DATA_DIR: serverDir,
      YYS_HOST: '127.0.0.1',
      YYS_PORT: '0',
      YYS_ADMIN_PASSWORD: ADMIN_PASSWORD,
      YYS_SERVER_NAME: 'E2E 测试服务器',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务器未能启动：${output}`)), 20_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const url = /已启动：(https:\/\/[\d.]+:\d+)/.exec(output)?.[1];
      const fp = /证书指纹（SHA-256）：([0-9A-F:]+)/.exec(output)?.[1];
      if (url && fp) {
        serverUrl = url;
        fingerprint = fp;
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  });

  userDataDir = mkdtempSync(join(tmpdir(), 'yys-e2e-remote-'));
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, YYS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterAll(async () => {
  await app?.close();
  server?.kill('SIGTERM');
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(serverDir, { recursive: true, force: true });
});

test('在登录框中更改连接：测试服务器、核对证书指纹后信任并连接', async () => {
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await expect(dialog().getByText('使用本机数据')).toBeVisible();
  await dialog().getByRole('button', { name: '更改' }).click();
  await page.getByRole('radio', { name: /团队服务器/ }).click();
  await page.getByPlaceholder('https://').fill(serverUrl);
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('E2E 测试服务器')).toBeVisible();
  await expect(page.getByText(fingerprint)).toBeVisible();
  await shot('11-connect-server');
  await page.getByRole('button', { name: '信任并连接' }).click();
  // 切换后窗口重新加载
  await expect(page.getByText(/已连接服务器 · E2E 测试服务器/)).toBeVisible({ timeout: 20_000 });
});

test('登录服务器：不提示初始密码；书库数据来自服务器', async () => {
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await expect(dialog().getByText('已连接服务器：E2E 测试服务器')).toBeVisible();
  await expect(dialog().getByText('初始密码')).toHaveCount(0);
  await dialog().getByLabel('用户名').fill('super_user');
  await dialog().getByRole('textbox', { name: '密码' }).fill(ADMIN_PASSWORD);
  await dialog()
    .getByLabel(/记住密码/)
    .check();
  await dialog().getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText('欢迎回来，超级管理员')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: /^书库/ }).click();
  await expect(page.getByText('共 28 本')).toBeVisible();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '数据与隐私' }).click();
  await expect(page.getByText(`服务器：${serverDir}`)).toBeVisible();
  await shot('12-server-settings');
});

test('记住密码：退出后在本机一键登录服务器账号', async () => {
  await page.getByRole('button', { name: /^超 超级管理员/ }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await dialog().getByRole('button', { name: '以 超级管理员 登录' }).click();
  await expect(page.getByText('已切换到 超级管理员')).toBeVisible();
});

test('切回本机：本机数据与服务器互不影响', async () => {
  await page.getByText(/已连接服务器 · E2E 测试服务器/).click();
  await page.getByRole('button', { name: '更改连接' }).click();
  await page.getByRole('radio', { name: /本机/ }).click();
  await page.getByRole('button', { name: '切换到本机' }).click();
  await expect(page.getByText(/已连接服务器/)).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await expect(dialog().getByText('使用本机数据')).toBeVisible();
  // 本机仍是初始状态：登录框提示内置管理员的初始密码
  await expect(dialog().getByText('初始密码')).toBeVisible();
});

test('没有控制台错误', () => {
  expect(errors).toEqual([]);
});
