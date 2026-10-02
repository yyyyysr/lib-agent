import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const shots = join(import.meta.dirname, '..', 'e2e-results', 'screenshots', process.platform);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const errors: string[] = [];

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'yys-e2e-'));
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, YYS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 860 });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const shot = (name: string) => page.screenshot({ path: join(shots, `${name}.png`) });

test('首页：标题、BYOK 引导与示例主题', async () => {
  await expect(page.getByRole('heading', { name: '今天想策划什么主题的书展？' })).toBeVisible();
  await expect(page.getByText('先添加一个模型服务商')).toBeVisible();
  await expect(page.getByText('新生如何识别 AI 生成的信息')).toBeVisible();
  await shot('01-home');
});

test('书库：示例书库已灌入，两字关键词可检索', async () => {
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await expect(page.getByText('共 28 本')).toBeVisible();
  await page.getByPlaceholder('按书名、作者、主题词、摘要检索').fill('算法');
  // 示例书库中《算法霸权》有一条刻意保留的重复记录
  await expect(page.getByText('共 2 本')).toBeVisible();
  await expect(page.getByRole('cell', { name: /算法霸权：数学杀伤性武器的威胁/ })).toBeVisible();
  await shot('02-library');
  await page.getByPlaceholder('按书名、作者、主题词、摘要检索').fill('');
});

test('书库：粘贴导入生成新的来源', async () => {
  await page.getByRole('button', { name: '导入书目' }).click();
  await page.getByRole('menuitem', { name: '粘贴文本' }).click();
  await page.getByLabel('来源名称').fill('学院资料室');
  await page.getByLabel('书目内容').fill('《乡土中国》费孝通\n思考，快与慢 / 丹尼尔·卡尼曼 / 中信出版社');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('已导入 2 本到“学院资料室”')).toBeVisible();
  await shot('03-import-report');
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByText('共 30 本')).toBeVisible();
});

test('设置：服务商选择与表单', async () => {
  await page.getByRole('button', { name: /^设置/ }).click();
  await expect(page.getByText('还没有配置模型')).toBeVisible();
  await page.getByRole('button', { name: '添加服务商' }).click();
  await expect(page.getByText('国内服务商')).toBeVisible();
  await shot('04-provider-presets');
  await page.getByRole('button', { name: /DeepSeek 深度求索/ }).click();
  await expect(page.getByText('前往 DeepSeek 深度求索 获取 Key')).toBeVisible();
  await shot('05-provider-form');
  await page.keyboard.press('Escape');
});

test('设置：学校与馆藏', async () => {
  await page.getByRole('button', { name: '学校与馆藏' }).click();
  await expect(page.getByText('校园馆藏数据库')).toBeVisible();
  await shot('06-school');
});

test('对话：未配置模型时给出可操作的错误', async () => {
  await page.getByRole('button', { name: '新建书展', exact: true }).click();
  await page.getByPlaceholder('描述主题、目标读者、活动时间与场地…').fill('帮我找几本关于批判性思维的书');
  await page.keyboard.press('Enter');
  await expect(page.getByText('还没有选择主模型')).toBeVisible();
  await expect(page.getByText('活动包', { exact: true })).toBeVisible();
  // 即使模型未配置，问题也已保存为书展任务
  await expect(page.getByRole('button', { name: '帮我找几本关于批判性思维的书' })).toBeVisible();
  await shot('07-chat-no-model');
});

test('深色模式', async () => {
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '外观' }).click();
  await page.getByRole('button', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await page.waitForTimeout(300);
  await shot('08-library-dark');
});

test('后台服务被强制结束后自动重启，界面自动重连', async () => {
  const corePid = () =>
    app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().find((m) => m.type === 'Utility' && m.name === 'YiyeShuzhan Core')?.pid);
  const before = await corePid();
  expect(before).toBeTruthy();
  process.kill(before!, 'SIGKILL');

  await expect.poll(corePid, { timeout: 15_000 }).not.toBe(before);
  await expect(page.getByText('正在自动恢复', { exact: false })).toBeHidden({ timeout: 15_000 });

  await page.getByRole('button', { name: '新建书展', exact: true }).click();
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await expect(page.getByText('共 30 本')).toBeVisible();
});

test('没有控制台错误', () => {
  expect(errors).toEqual([]);
});
