import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const shots = join(import.meta.dirname, '..', 'e2e-results', 'screenshots', process.platform);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const errors: string[] = [];

const accounts = {
  admin: { username: 'super_user', password: '12345678', name: '超级管理员', no: 'ADMIN' },
  curator: { username: 'curator', password: 'curator-pass', name: '李同学', no: '2024010203' },
  reviewer: { username: 'reviewer', password: 'reviewer-pass', name: '王老师', no: 'T9001' },
};
type Account = (typeof accounts)[keyof typeof accounts];
let current: Account | null = null;

test.describe.configure({ mode: 'serial' });

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      YYS_USER_DATA_DIR: userDataDir,
      YYS_E2E_SCRIPTED_MODEL: '1',
      NODE_ENV: 'production',
    },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'yys-e2e-'));
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const shot = (name: string) => page.screenshot({ path: join(shots, `${name}.png`) });
/** 等首页的渐显、数字滚动等过渡动画结束再截图 */
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

/** 已登录时通过“登录其他账号…”注册新账号，并勾选记住密码 */
async function register(account: Account): Promise<void> {
  if (current) {
    await userButton(current).click();
    await page.getByRole('menuitem', { name: '登录其他账号…' }).click();
  } else {
    await page.getByRole('button', { name: '登录 / 注册' }).click();
  }
  const d = dialog();
  await expect(d.getByRole('heading', { name: '登录一页书展' })).toBeVisible();
  await d.getByRole('button', { name: '注册', exact: true }).click();
  await d.getByLabel('用户名').fill(account.username);
  await d.getByLabel('密码', { exact: true }).fill(account.password);
  await d.getByLabel('确认密码').fill(account.password);
  await d.getByLabel('姓名').fill(account.name);
  await d.getByLabel('学号 / 工号').fill(account.no);
  await d.getByLabel(/记住密码/).check();
  await d.getByRole('button', { name: '注册并登录' }).click();
  await expect(userButton(account)).toBeVisible();
  current = account;
}

/** 切换到已记住密码的账号：已登录时用账号菜单，未登录时用登录框中的“一键登录” */
async function actAs(account: Account): Promise<void> {
  if (current === account) return;
  if (current) {
    await userButton(current).click();
    await page.getByRole('menuitem', { name: new RegExp(account.name) }).click();
  } else {
    await page.getByRole('button', { name: '登录 / 注册' }).click();
    await dialog()
      .getByRole('button', { name: `以 ${account.name} 登录` })
      .click();
  }
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

test('首页：还没有上线的书展时展示流程介绍', async () => {
  await expect(page.getByRole('heading', { name: '还没有上线的书展' })).toBeVisible();
  await shot('01-home-empty');
});

test('内置超级管理员：用初始账号登录并记住密码，配置共享模型', async () => {
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  const d = dialog();
  await expect(d.getByText('初始密码')).toBeVisible();
  await shot('02-login');
  await d.getByRole('button', { name: '填入' }).click();
  await d.getByLabel(/记住密码/).check();
  await d.getByRole('button', { name: '登录', exact: true }).click();
  await expect(userButton(accounts.admin)).toBeVisible();
  current = accounts.admin;
  await expect(page.getByText('超级管理员仍在使用初始密码，请尽快修改。')).toBeVisible();

  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '模型与密钥' }).click();
  await page.getByRole('button', { name: '添加服务商' }).first().click();
  await dialog()
    .getByRole('button', { name: /Ollama/ })
    .click();
  await dialog()
    .getByPlaceholder(/手动填写模型名称/)
    .fill('qwen3');
  await dialog().getByRole('button', { name: '添加', exact: true }).click();
  await dialog().getByText('共享给全部用户').click();
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('全员共享')).toBeVisible();

  // 生图模型单独接入，并测试生成
  await page
    .getByLabel('模型', { exact: true })
    .selectOption({ label: 'Ollama（本地模型） · qwen3' });
  await page.getByRole('button', { name: '测试生图' }).click();
  await expect(page.getByAltText('测试生成的图片')).toBeVisible({ timeout: 20_000 });
  await shot('02-image-model');
});

test('书库：实体书封面，点击条目展开详情，示例书链接可打开；可切换书架视图', async () => {
  await nav('书库');
  await expect(page.getByText('共 28 本')).toBeVisible();
  const row = page.getByRole('button', { name: /思考，快与慢/ }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('button', { name: 'https://book.douban.com/subject/10785583/' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '打开来源页面' })).toBeVisible();
  await shot('03-library-detail');
  await page.getByRole('button', { name: '书架' }).click();
  await expect(page.getByRole('img', { name: '《乡土中国》' })).toBeVisible();
  await shot('03-library-shelf');
  await page
    .getByRole('button', { name: /乡土中国/ })
    .first()
    .click();
  await expect(dialog().getByRole('heading', { name: '书目详情' })).toBeVisible();
  await dialog().getByRole('button', { name: '关闭' }).click();
  await expect(dialog()).toHaveCount(0);
  await page.getByRole('button', { name: '列表' }).click();
});

test('注册一律为普通用户；通过账号菜单切换，超级管理员分配审批权限', async () => {
  await register(accounts.curator);
  await expect(page.getByText('普通用户', { exact: true })).toBeVisible();
  // 普通用户看不到审批与管理入口
  await expect(page.getByRole('navigation').getByRole('button', { name: /^审批/ })).toHaveCount(0);
  await register(accounts.reviewer);
  await expect(page.getByText('普通用户', { exact: true })).toBeVisible();

  await userButton(accounts.reviewer).click();
  await shot('03-switch-menu');
  await page.keyboard.press('Escape');
  await actAs(accounts.admin);
  await nav('管理');
  await expect(page.getByLabel(`${accounts.admin.name} 的角色`)).toBeDisabled();
  await page.getByLabel(`${accounts.reviewer.name} 的角色`).selectOption('approver');
  await expect(page.getByText('角色已更新')).toBeVisible();
  await shot('03-admin-users');
});

test('策展人：填写需求 → 智能体策展 → 核对清单', async () => {
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
  await d.getByRole('button', { name: '创建并开始策展' }).click();

  await expect(page.getByText('核对清单', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/来自示例书库/).first()).toBeVisible();
  await expect(page.getByText('策展完成：8 本书')).toBeVisible();
  await shot('04-review');
});

test('策展人：确认方案 → 生成策展申请书 → 提交立项审批', async () => {
  await page.getByRole('button', { name: '确认无误，生成策展申请书' }).click();
  await expect(page.getByText('主题书展策展申请书')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: /李同学（学号\/工号：2024010203）/ })).toBeVisible();
  await shot('05-proposal');
  await page.getByRole('button', { name: '提交立项审批' }).click();
  await expect(page.getByText('立项审批中').first()).toBeVisible();
});

test('审批人：同意立项', async () => {
  await actAs(accounts.reviewer);
  await nav('审批');
  await page.getByRole('button', { name: /立项审批.*真假之间/ }).click();
  await page.getByPlaceholder(/填写意见/).fill('选题贴合新生需求，同意立项。');
  await shot('06-approve-proposal');
  await page.getByRole('button', { name: '同意', exact: true }).click();
  await expect(page.getByText('立项审批：同意', { exact: true })).toBeVisible();
});

test('策展人：看到“同意”，生成海报与完整活动包并提交上线审批', async () => {
  await actAs(accounts.curator);
  await openExhibition();
  await page.getByRole('button', { name: /立项审批/ }).click();
  await expect(page.getByText('立项审批：同意', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成海报与完整活动包' }).click();
  await expect(page.getByRole('button', { name: '导出 PNG' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '国风水墨' }).click();
  await page.getByRole('button', { name: 'AI 绘制画面' }).click();
  await expect(page.getByRole('button', { name: '使用这张画面' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'AI 画面', exact: true })).toHaveClass(/bg-fg/);
  await page
    .getByRole('img', { name: /^海报：/ })
    .first()
    .scrollIntoViewIfNeeded();
  await shot('07-package');
  await page.getByRole('button', { name: '提交上线审批' }).click();
  await expect(page.getByText('上线审批中').first()).toBeVisible();
});

test('审批人：同意上线，首页更新为最新一期', async () => {
  await actAs(accounts.reviewer);
  await nav('审批');
  await page.getByRole('button', { name: /上线审批.*真假之间/ }).click();
  await page.getByRole('button', { name: '同意', exact: true }).click();
  await expect(page.getByText('上线审批：同意', { exact: true }).first()).toBeVisible();

  await nav('首页');
  await expect(page.getByText('最新一期')).toBeVisible();
  await expect(page.getByRole('heading', { name: '真假之间' })).toBeVisible();
  await expect(page.getByText('图书馆一楼大厅').first()).toBeVisible();
  // 海报悬停倾斜
  await page.getByRole('img', { name: /^海报：/ }).hover({ position: { x: 60, y: 60 } });
  await settled();
  await shot('08-home-published');
  await page.getByRole('button', { name: '查看《AI 3.0》', exact: true }).click();
  await expect(dialog().getByText('本期导读')).toBeVisible();
  await settled();
  await shot('08-home-book-detail');
  await dialog().getByRole('button', { name: '关闭' }).click();
  await expect(dialog()).toHaveCount(0);
});

test('策展人：录入执行记录与反馈，生成复盘，首页展示活动成果', async () => {
  await actAs(accounts.curator);
  await openExhibition();
  await page.getByRole('button', { name: /上线与反馈/ }).click();
  await page.getByLabel('参与人数').fill('36');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page
    .getByPlaceholder(/每行一条反馈/)
    .fill('5 案例讨论很有收获\n4分：希望多一些实操练习\n联系我 13812345678');
  await page.getByRole('button', { name: '录入反馈' }).click();
  await expect(page.getByText('［手机号已隐去］')).toBeVisible();
  await page.getByRole('button', { name: '前往复盘' }).click();
  await page.getByRole('button', { name: '生成复盘总结' }).click();
  await expect(page.getByText('给下一期的建议（每行一条）')).toBeVisible({ timeout: 20_000 });
  await shot('09-retro');

  await nav('首页');
  await expect(page.getByText('活动成果')).toBeVisible();
  await page.getByText('活动成果').scrollIntoViewIfNeeded();
  await expect(page.getByText('36', { exact: true })).toBeVisible();
  await expect(page.getByText('4.5 / 5')).toBeVisible();
  await settled();
  await shot('10-home-results');
});

test('后台服务被强制结束后自动重启，登录状态保持', async () => {
  const corePid = () =>
    app.evaluate(
      ({ app: electronApp }) =>
        electronApp
          .getAppMetrics()
          .find((m) => m.type === 'Utility' && m.name === 'YiyeShuzhan Core')?.pid,
    );
  const before = await corePid();
  expect(before).toBeTruthy();
  process.kill(before!, 'SIGKILL');
  await expect.poll(corePid, { timeout: 15_000 }).not.toBe(before);
  await nav('策展');
  await expect(page.getByRole('button', { name: /真假之间/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: new RegExp(accounts.curator.name) })).toBeVisible();
});

test('记住密码：退出登录并重启应用后，在登录框中一键登录', async () => {
  await userButton(current!).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  current = null;

  await app.close();
  await launch();
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await expect(
    dialog()
      .getByText(/已记住密码/)
      .first(),
  ).toBeVisible();
  await shot('11-saved-accounts');
  await dialog()
    .getByRole('button', { name: `以 ${accounts.reviewer.name} 登录` })
    .click();
  await expect(userButton(accounts.reviewer)).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: /^审批/ })).toBeVisible();
});

test('没有控制台错误', () => {
  expect(errors).toEqual([]);
});
