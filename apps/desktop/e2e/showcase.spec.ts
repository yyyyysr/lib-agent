import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * 为 README 与使用手册截图：用演示脚本（内容接近真实模型的回答）走完完整流程，再连接本地启动的服务器。
 * 只在 YYS_SHOWCASE=1 时运行：pnpm --filter @yys/desktop showcase
 */
test.skip(!process.env.YYS_SHOWCASE, '仅在生成截图时运行');
test.describe.configure({ mode: 'serial' });

const out = join(import.meta.dirname, '..', 'e2e-results', 'showcase');
const root = join(import.meta.dirname, '..', '..', '..');
const artwork = join(import.meta.dirname, 'fixtures', 'demo-artwork.jpg');
const ADMIN_NEW_PASSWORD = 'Library-2026';
const SERVER_ADMIN_PASSWORD = 'Server-Admin-2026';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const accounts = {
  admin: { username: 'super_user', password: '12345678', name: '超级管理员', no: 'ADMIN' },
  curator: { username: 'yangsiran', password: 'curator-2026', name: '杨斯然', no: '2024010203' },
  reviewer: { username: 'wanglaoshi', password: 'reviewer-2026', name: '王老师', no: 'T9001' },
};
type Account = (typeof accounts)[keyof typeof accounts];
let current: Account | null = null;

async function launch(extraEnv: Record<string, string> = {}): Promise<void> {
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      YYS_USER_DATA_DIR: userDataDir,
      YYS_E2E_SCRIPTED_MODEL: 'demo',
      YYS_DEMO_ARTWORK: artwork,
      NODE_ENV: 'production',
      ...extraEnv,
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** 截图时隐藏右下角的操作提示 */
const hideToasts = '.fixed.right-5.bottom-5 { display: none !important; }';
/** 截图：kind 为 readme 或 manual；GIF 帧另存 */
const shot = async (kind: 'readme' | 'manual', name: string): Promise<void> => {
  mkdirSync(join(out, kind), { recursive: true });
  await page.screenshot({ path: join(out, kind, `${name}.png`), style: hideToasts });
};
const frames: Record<string, { file: string; delay: number }[]> = {};
const frame = async (gif: string, delay = 1200): Promise<void> => {
  const dir = join(out, 'frames', gif);
  mkdirSync(dir, { recursive: true });
  const list = (frames[gif] ??= []);
  const file = join(dir, `${String(list.length).padStart(3, '0')}.png`);
  await page.screenshot({ path: file, style: hideToasts });
  list.push({ file, delay });
};
const settled = () =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const nav = (name: string) =>
  page
    .getByRole('navigation')
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
const dialog = () => page.getByRole('dialog');
const userButton = (account: Account) =>
  page.getByRole('button', { name: new RegExp(`^${account.name.slice(0, 1)} ${account.name}`) });

async function register(account: Account, capture = false): Promise<void> {
  if (current) {
    await userButton(current).click();
    await page.getByRole('menuitem', { name: '登录其他账号…' }).click();
  } else {
    await page.getByRole('button', { name: '登录 / 注册' }).click();
  }
  const d = dialog();
  await d.getByRole('button', { name: '注册', exact: true }).click();
  await d.getByLabel('用户名').fill(account.username);
  await d.getByLabel('密码', { exact: true }).fill(account.password);
  await d.getByLabel('确认密码').fill(account.password);
  await d.getByLabel('姓名').fill(account.name);
  await d.getByLabel('学号 / 工号').fill(account.no);
  await d
    .getByLabel('学院 / 部门（可选）')
    .fill(account === accounts.curator ? '信息管理学院' : '图书馆阅读推广部');
  await d.getByLabel(/记住密码/).check();
  if (capture) await shot('manual', '05-register');
  await d.getByRole('button', { name: '注册并登录' }).click();
  await expect(userButton(account)).toBeVisible();
  current = account;
}

async function actAs(account: Account): Promise<void> {
  if (current === account) return;
  await userButton(current!).click();
  await page.getByRole('menuitem', { name: new RegExp(account.name) }).click();
  await expect(userButton(account)).toBeVisible();
  current = account;
}

async function openExhibition(): Promise<void> {
  await nav('策展');
  await page
    .getByRole('button', { name: /真假之间/ })
    .first()
    .click();
}

test.beforeAll(async () => {
  rmSync(out, { recursive: true, force: true });
  userDataDir = mkdtempSync(join(tmpdir(), 'yys-showcase-'));
  await launch();
});

test.afterAll(async () => {
  writeFileSync(join(out, 'frames.json'), JSON.stringify(frames, null, 2));
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('首次使用：首页、登录、修改初始密码', async () => {
  await expect(page.getByRole('heading', { name: '还没有上线的书展' })).toBeVisible();
  await settled();
  await shot('manual', '01-home-empty');

  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await expect(dialog().getByText('初始密码')).toBeVisible();
  await shot('manual', '02-login');
  await dialog().getByRole('button', { name: '填入' }).click();
  await dialog()
    .getByLabel(/记住密码/)
    .check();
  await dialog().getByRole('button', { name: '登录', exact: true }).click();
  await expect(userButton(accounts.admin)).toBeVisible();
  current = accounts.admin;
  await expect(page.getByText('超级管理员仍在使用初始密码，请尽快修改。')).toBeVisible();

  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByLabel('原密码').fill(accounts.admin.password);
  await page.getByLabel('新密码').fill(ADMIN_NEW_PASSWORD);
  await shot('manual', '03-change-password');
  await page.getByRole('button', { name: '修改密码' }).last().click();
  await expect(page.getByText('超级管理员仍在使用初始密码，请尽快修改。')).toHaveCount(0);
});

test('配置模型：添加服务商（共享给全部用户）、模型分工与生图模型', async () => {
  await page.getByRole('button', { name: '模型与密钥' }).click();
  await page.getByRole('button', { name: '添加服务商' }).first().click();
  await dialog()
    .getByRole('button', { name: /DeepSeek/ })
    .click();
  await dialog().getByPlaceholder('sk-…').fill('sk-demo-0000000000000000000000');
  await dialog()
    .getByPlaceholder(/手动填写模型名称/)
    .fill('deepseek-chat');
  await dialog().getByRole('button', { name: '添加', exact: true }).click();
  await dialog().getByText('共享给全部用户').click();
  await shot('manual', '04-provider-dialog');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('全员共享', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '添加服务商' }).first().click();
  await dialog()
    .getByRole('button', { name: /硅基流动/ })
    .click();
  await dialog().getByPlaceholder('sk-…').fill('sk-demo-1111111111111111111111');
  await dialog()
    .getByPlaceholder(/手动填写模型名称/)
    .fill('Kwai-Kolors/Kolors');
  await dialog().getByRole('button', { name: '添加', exact: true }).click();
  await dialog().getByText('共享给全部用户').click();
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('全员共享', { exact: true })).toHaveCount(2);
  await page
    .getByLabel('模型', { exact: true })
    .selectOption({ label: '硅基流动 SiliconFlow · Kwai-Kolors/Kolors' });
  await expect(page.getByText('已保存', { exact: false }).first())
    .toBeVisible()
    .catch(() => undefined);
  await settled();
  await shot('manual', '06-models');
  await shot('readme', 'settings-models');
});

test('账号：注册策展人与审批人，超级管理员分配审批权限', async () => {
  await register(accounts.curator, true);
  await register(accounts.reviewer);
  await userButton(accounts.reviewer).click();
  await shot('manual', '08-switch-account');
  await page.keyboard.press('Escape');
  await actAs(accounts.admin);
  await nav('管理');
  await page.getByLabel(`${accounts.reviewer.name} 的角色`).selectOption('approver');
  await expect(page.getByText('角色已更新')).toBeVisible();
  await shot('manual', '07-admin-users');
});

test('书库：浏览、详情、书架与导入', async () => {
  await nav('书库');
  await expect(page.getByText('共 28 本')).toBeVisible();
  await settled();
  await frame('library', 1400);
  await shot('manual', '20-library-list');
  const row = page.getByRole('button', { name: /思考，快与慢/ }).first();
  await row.click();
  await expect(page.getByText('中图分类：F069.9-49')).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByAltText('《思考，快与慢》封面')
        .last()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(100);
  await page.getByText('详细信息').scrollIntoViewIfNeeded();
  await settled();
  await frame('library', 2200);
  await shot('readme', 'library-detail');
  await shot('manual', '21-library-detail');
  await row.click();
  await page.getByRole('button', { name: '书架' }).click();
  await expect(page.getByAltText('《乡土中国》封面')).toBeVisible();
  await page.waitForTimeout(800);
  await settled();
  await frame('library', 1600);
  await shot('readme', 'library-shelf');
  await shot('manual', '22-library-shelf');
  const card = page.getByRole('button', { name: /大数据时代/ }).first();
  await card.hover();
  await page.waitForTimeout(400);
  await frame('library', 900);
  await card.click();
  await expect(dialog().getByRole('heading', { name: '书目详情' })).toBeVisible();
  await settled();
  await frame('library', 2200);
  await dialog().getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '列表' }).click();
  await page.getByRole('button', { name: /导入书目/ }).click();
  await shot('manual', '23-library-import');
  await page.getByRole('menuitem', { name: /粘贴文本/ }).click();
  await shot('manual', '24-library-paste');
  await dialog().getByRole('button', { name: '关闭' }).click();
  await expect(dialog()).toHaveCount(0);
});

test('策展：填写需求 → 智能体策展 → 核对清单', async () => {
  await actAs(accounts.curator);
  await nav('策展');
  await page.getByRole('button', { name: '发起策展' }).first().click();
  const d = dialog();
  await d.getByLabel('主题').fill('新生如何识别 AI 生成的信息');
  await d.getByLabel('目标读者').fill('大一新生');
  await d.getByLabel('活动日期').fill('2026-11-15');
  await d.getByLabel('活动时间').fill('14:00–15:00');
  await d.getByLabel('场地').fill('图书馆一楼大厅');
  await d.getByLabel('期望书目数量').fill('8');
  await d.getByLabel('特殊要求（可选）').fill('兼顾经典与新书，篇幅适中，适合新生入门');
  await shot('manual', '10-brief');
  await frame('workflow', 1800);
  await d.getByRole('button', { name: '创建并开始策展' }).click();
  await expect(page.getByText('核对清单', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('策展完成：8 本书')).toBeVisible();
  await settled();
  await shot('manual', '11-review');
  await shot('readme', 'curation-review');
  await frame('workflow', 2200);
});

test('策展：申请书与立项审批', async () => {
  await page.getByRole('button', { name: '确认无误，生成策展申请书' }).click();
  await expect(page.getByText('主题书展策展申请书')).toBeVisible({ timeout: 20_000 });
  await settled();
  await shot('manual', '12-proposal');
  await shot('readme', 'proposal');
  await frame('workflow', 2000);
  await page.getByRole('button', { name: '提交立项审批' }).click();
  await expect(page.getByText('立项审批中').first()).toBeVisible();

  await actAs(accounts.reviewer);
  await nav('审批');
  await page.getByRole('button', { name: /立项审批.*真假之间/ }).click();
  await page.getByPlaceholder(/填写意见/).fill('选题贴合新生需求，书目选择合理，同意立项。');
  await settled();
  await shot('manual', '13-approve');
  await shot('readme', 'approval');
  await frame('workflow', 2000);
  await page.getByRole('button', { name: '同意', exact: true }).click();
  await expect(page.getByText('立项审批：同意', { exact: true })).toBeVisible();
});

test('策展：海报与活动包（AI 绘制画面）、上线审批', async () => {
  await actAs(accounts.curator);
  await openExhibition();
  await page.getByRole('button', { name: /立项审批/ }).click();
  await page.getByRole('button', { name: '生成海报与完整活动包' }).click();
  await expect(page.getByRole('button', { name: '导出 PNG' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '国风水墨' }).click();
  await page.getByRole('button', { name: 'AI 绘制画面' }).click();
  await expect(page.getByRole('button', { name: '使用这张画面' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await page
    .getByRole('img', { name: /^海报：/ })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await settled();
  await shot('manual', '14-package');
  await shot('readme', 'poster');
  await frame('workflow', 2400);
  await page.getByText('推文', { exact: false }).first().scrollIntoViewIfNeeded();
  await settled();
  await shot('manual', '15-package-materials');
  await page.getByRole('button', { name: '提交上线审批' }).click();
  await expect(page.getByText('上线审批中').first()).toBeVisible();

  await actAs(accounts.reviewer);
  await nav('审批');
  await page.getByRole('button', { name: /上线审批.*真假之间/ }).click();
  await page.getByPlaceholder(/填写意见/).fill('海报与活动材料完整，同意上线。');
  await page.getByRole('button', { name: '同意', exact: true }).click();
  await expect(page.getByText('上线审批：同意', { exact: true }).first()).toBeVisible();
});

test('首页：最新一期书展、悬停交互与书目详情', async () => {
  await nav('首页');
  await expect(page.getByText('最新一期')).toBeVisible();
  await page.mouse.move(1300, 850);
  await settled();
  await shot('manual', '16-home-published');
  await frame('workflow', 2600);

  const poster = page.getByRole('img', { name: /^海报：/ });
  const box = (await poster.boundingBox())!;
  await frame('home', 900);
  // 鼠标在海报上划过：倾斜与光泽跟随指针
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    await page.mouse.move(
      box.x + box.width * (0.15 + 0.7 * t),
      box.y + box.height * (0.25 + 0.5 * Math.sin(t * Math.PI)),
    );
    await page.waitForTimeout(60);
    await frame('home', 110);
  }
  await settled();
  await frame('home', 1200);
  // 书目封面叠放：悬停展开
  const stack = page.getByRole('button', { name: /^查看《/ }).first();
  await stack.hover();
  await page.waitForTimeout(500);
  await frame('home', 1000);
  // 向下滚动：各区块渐显
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(700, 600);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(420);
    await frame('home', 500);
  }
  const bookCard = page.getByRole('button', { name: /《思考，快与慢》/ }).last();
  await bookCard.scrollIntoViewIfNeeded();
  await bookCard.hover();
  await page.waitForTimeout(500);
  await frame('home', 1200);
  await bookCard.click();
  await expect(dialog().getByText('本期导读')).toBeVisible();
  await settled();
  await frame('home', 2200);
  await shot('manual', '17-home-book-detail');
  await dialog().getByRole('button', { name: '关闭' }).click();
});

test('上线后：录入执行记录与反馈，生成复盘，首页展示活动成果', async () => {
  await actAs(accounts.curator);
  await openExhibition();
  await page.getByRole('button', { name: /上线与反馈/ }).click();
  await page.getByLabel('参与人数').fill('36');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page
    .getByPlaceholder(/每行一条反馈/)
    .fill(
      [
        '5 辨析环节很有意思，第一次知道 AI 生成的图片可以这样查',
        '4分：希望多给一些动手练习的时间',
        '5 想借《思考，快与慢》，现场就办好了借阅',
        '4 海报上的活动时间有点小，差点没注意到',
        '5 三个展区的顺序很清楚，从认识信息到判断信息',
      ].join('\n'),
    );
  await shot('manual', '18-feedback');
  await page.getByRole('button', { name: '录入反馈' }).click();
  await page.getByRole('button', { name: '前往复盘' }).click();
  await page.getByRole('button', { name: '生成复盘总结' }).click();
  await expect(page.getByText('给下一期的建议（每行一条）')).toBeVisible({ timeout: 20_000 });
  await settled();
  await shot('manual', '19-retro');
  await frame('workflow', 2200);

  await nav('首页');
  await page.getByText('活动成果').scrollIntoViewIfNeeded();
  await expect(page.getByText('36', { exact: true })).toBeVisible();
  await settled();
  await shot('manual', '16b-home-results');
  await shot('readme', 'home-results');
  await frame('workflow', 2400);
});

test('外观：深色模式', async () => {
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '外观' }).click();
  await page.getByRole('button', { name: '深色' }).click();
  await nav('首页');
  await page.mouse.move(1300, 850);
  await page.evaluate(() =>
    document.querySelector('main [class*="overflow-y-auto"]')?.scrollTo(0, 0),
  );
  await page.waitForTimeout(800);
  await settled();
  await shot('readme', 'home-dark');
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '外观' }).click();
  await page.getByRole('button', { name: '浅色' }).click();
});

test('团队服务器：连接、核对证书指纹、登录服务器账号', async () => {
  const serverBundle = join(root, 'apps', 'server', 'dist', 'server.mjs');
  if (!existsSync(serverBundle))
    execFileSync('pnpm', ['--filter', '@yys/server', 'build'], {
      cwd: root,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
  const serverDir = mkdtempSync(join(tmpdir(), 'yys-showcase-server-'));
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
      '/CN=yiyeshuzhan',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      join(serverDir, 'tls', 'server.key'),
      '-out',
      join(serverDir, 'tls', 'server.crt'),
    ],
    { stdio: 'ignore' },
  );
  const server: ChildProcess = spawn(process.execPath, [serverBundle], {
    env: {
      ...process.env,
      YYS_DATA_DIR: serverDir,
      YYS_HOST: '127.0.0.1',
      YYS_PORT: '0',
      YYS_ADMIN_PASSWORD: SERVER_ADMIN_PASSWORD,
      YYS_SERVER_NAME: '中山大学图书馆 · 一页书展服务器',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 20_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const found = /已启动：(https:\/\/[\d.]+:\d+)/.exec(output)?.[1];
      if (found && /证书指纹/.test(output)) {
        clearTimeout(timer);
        resolve(found);
      }
    });
  });
  try {
    await userButton(current!).click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    current = null;
    await page.getByRole('button', { name: '登录 / 注册' }).click();
    await dialog().getByRole('button', { name: '更改' }).click();
    await page.getByRole('radio', { name: /团队服务器/ }).click();
    await page.getByPlaceholder('https://').fill(url);
    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('证书指纹（SHA-256）')).toBeVisible();
    await page.mouse.move(1300, 850);
    await shot('manual', '31-connect-server');
    await shot('readme', 'connect-server');
    await page.getByRole('button', { name: '信任并连接' }).click();
    await expect(page.getByText(/已连接服务器 ·/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '登录 / 注册' }).click();
    await dialog().getByLabel('用户名').fill('super_user');
    await dialog().getByRole('textbox', { name: '密码' }).fill(SERVER_ADMIN_PASSWORD);
    await shot('manual', '32-server-login');
    await dialog().getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('超级管理员仍在使用初始密码，请尽快修改。')).toBeVisible();
    await page.getByRole('button', { name: /^设置/ }).click();
    await page.getByRole('button', { name: '数据与隐私' }).click();
    await settled();
    await shot('manual', '33-server-settings');
    // 切回本机，便于下次直接使用
    await page.getByRole('button', { name: '更改连接' }).click();
    await page.getByRole('radio', { name: /本机/ }).click();
    await page.getByRole('button', { name: '切换到本机' }).click();
    await expect(page.getByText(/已连接服务器/)).toHaveCount(0, { timeout: 20_000 });
  } finally {
    server.kill('SIGTERM');
    rmSync(serverDir, { recursive: true, force: true });
  }
});
