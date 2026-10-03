import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  _electron as electron,
  expect,
  test,
  type CDPSession,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { installDemoOverlay } from './demo-overlay';

/**
 * 录制参赛演示视频：用演示脚本代替真实模型，在真实界面上走完一期书展，
 * 同时录下高清画面帧与旁白时间轴，由 submit/build_demo_video.py 合成 MP4。
 * 只在 YYS_DEMO_VIDEO=1 时运行。
 */
test.skip(!process.env.YYS_DEMO_VIDEO, '仅在录制演示视频时运行');
test.setTimeout(30 * 60_000);

const root = join(import.meta.dirname, '..', '..', '..');
const OUT = process.env.YYS_DEMO_OUT ?? join(root, 'submit', '_demo');
const FRAMES = join(OUT, 'frames');
const AUDIO = join(OUT, 'audio');
const TTS = process.env.YYS_TTS_BIN ?? '/tmp/yys-submit-venv/bin/edge-tts';
const FFPROBE = process.env.FFPROBE ?? '/opt/homebrew/bin/ffprobe';
const VOICE = process.env.YYS_TTS_VOICE ?? 'zh-CN-XiaoxiaoNeural';
const RATE = process.env.YYS_TTS_RATE ?? '+6%';
const W = 1440;
const H = 810;
const artwork = join(import.meta.dirname, 'fixtures', 'demo-artwork.jpg');
const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const N = {
  c1_title:
    '大家好，我是杨斯然，参赛组别是个人组，赛道一：大学生 AI 创新创业。我的作品是「一页书展」，一款面向高校图书馆阅读推广的 AI 策展与运营智能体。',
  c1_pain:
    '图书馆每学期都要办主题书展。选书、写申请、做海报、走审批、收反馈，材料散在各处，往往要忙好几天；直接用通用大模型，又容易编造馆藏，把图书馆没有的书写进方案。',
  c1_flow:
    '一页书展把一期书展收成九个步骤：需求、智能体策展、核对清单、策展申请书、立项审批、海报与活动包、上线审批、上线与反馈，最后是复盘。',
  c1_feat:
    '它同时支持 macOS 和 Windows，可以单机使用，也能连接团队服务器多人协作。模型用自己的 API Key，请求直达服务商；智能体只从本校书库中选书，每一步都可以核对。',
  c1_next: '下面以“为大一新生办一期识别 AI 生成信息的书展”为例，完整演示一遍。',

  c2_login: '第一次打开，用内置的超级管理员登录。点“填入”，勾选记住密码，下次就能一键登录。',
  c2_pwd: '系统会提醒修改初始密码，我们在设置里马上改掉。',
  c2_provider:
    '接着配置大模型。国内的 DeepSeek、通义千问、Kimi、智谱、豆包、MiniMax，国外的 OpenAI、Gemini，还有本地模型，都可以接入。',
  c2_key:
    '这里选 DeepSeek，粘贴 API Key，填上模型名称。密钥只加密保存，界面上看不到明文；勾选共享给全部用户，其他账号就不用各自填写。',
  c2_image:
    '海报画面需要生图模型。选择 MiniMax 海螺，会自动带出对话模型和生图模型，保存后生图模型就配置好了。',
  c2_roles: '在模型分工里，主模型负责选书和写作，生图模型负责绘制海报画面。',
  c2_register: '一期书展由策展人发起、审批人把关。策展人杨斯然自己注册账号，学号会写进申请书。',
  c2_reviewer: '王老师也注册一个账号。',
  c2_admin_role: '超级管理员在“管理”页，把王老师的角色改成审批管理员。',
  c2_library: '再看书库。示例书库有二十七本真实图书，书目信息和索书号来自国家图书馆。',
  c2_library_detail:
    '展开一本书，能看到 ISBN、中图分类号、载体形态和索书号，读者凭索书号就能在书架上找到它。',
  c2_shelf: '书架视图按封面浏览。学校馆藏可以从 Excel、CSV、JSON 文件导入，表头会自动识别。',
  c2_brief:
    '现在切换到策展人，发起一期书展。填写主题、目标读者、时间和场地，期望八本书，再加一条特殊要求。',
  c2_agent:
    '点击创建，智能体开始工作：整理候选馆藏、筛选书目、规划展区、撰写导读，最后检查来源和字段。右侧面板实时显示每一步进度。',
  c2_review:
    '完成后进入核对清单。智能体只能从书库里选书，需要人工确认的地方都列在这里，比如缺少索书号的书、来自示例书库的书。',
  c2_review_edit: '展区标题和导读都能直接修改，不合适的书点“替换”就能换掉。确认无误，生成策展申请书。',
  c2_proposal:
    '申请书按正式格式生成：主题、形式、申请人、书单、目的、预期成果和所需支持，可以修改，也可以导出。确认后提交立项审批。',
  c2_approve:
    '切换到审批人王老师。打开这份申请书，填写意见，点同意；如果需要修改，也可以退回给策展人。',
  c2_package: '立项通过后，一键生成海报与完整活动包。',
  c2_poster:
    '选择国风水墨画风，让生图模型绘制海报画面。画面里不放文字，标题、时间、地点由模板排版，馆名和日期就不会写错。',
  c2_materials: '往下是公众号推文、报名介绍、校园通知和反馈问卷，每一段都能修改，也能一键导出。',
  c2_publish: '提交上线审批，王老师同意后，书展就发布到了首页。',

  c3_home:
    '所有人打开软件，首先看到最新一期书展：海报、时间地点、倒计时和展区书目。鼠标移到海报上，还有立体倾斜效果。',
  c3_book: '点开任意一本书，可以看到导读、入选理由和完整的书目信息。',
  c3_feedback:
    '活动结束后，策展人录入参与人数，把读者反馈粘贴进来。开头的数字是评分，手机号这类个人信息会自动隐去。',
  c3_retro:
    '一键生成复盘，智能体归纳有效做法、改进点和给下一期的建议，这些建议会自动成为下次策展的参考。',
  c3_results: '首页同步展示活动成果：参与人数、平均评分和精选好评。',
  c3_server:
    '多人协作时，连接学校部署的团队服务器。首次连接要逐段核对证书指纹，确认后软件只信任这张证书，API Key 也加密保存在服务器上。',
  c3_close:
    '从选题到复盘，一页书展把原本分散好几天的工作，收成一条连续、可核对、可审批的流程，让馆员把精力留给选题和读者。谢谢观看。',
} as const;
type Key = keyof typeof N;

const accounts = {
  admin: { username: 'super_user', password: '12345678', name: '超级管理员', no: 'ADMIN' },
  curator: { username: 'yangsiran', password: 'curator-2026', name: '杨斯然', no: '2024010203' },
  reviewer: { username: 'wanglaoshi', password: 'reviewer-2026', name: '王老师', no: 'T9001' },
};
type Account = (typeof accounts)[keyof typeof accounts];

let app: ElectronApplication;
let page: Page;
let cdp: CDPSession;
let userDataDir: string;
let server: ChildProcess | null = null;
let serverDir = '';
let serverUrl = '';
let current: Account | null = null;

const audio = {} as Record<Key, { file: string; dur: number }>;
const beats: { key: Key; text: string; t: number; file: string; dur: number }[] = [];
const chapters: { name: string; t: number }[] = [];
const frames: { t: number; f: string }[] = [];
let recStart = 0;
let frameNo = 0;

async function synth(key: Key): Promise<void> {
  const text = N[key];
  const hash = createHash('sha1').update(`${VOICE}|${RATE}|${text}`).digest('hex').slice(0, 10);
  const file = join(AUDIO, `${key}-${hash}.mp3`);
  for (let attempt = 0; !existsSync(file); attempt++) {
    try {
      await execFileP(TTS, ['--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', file]);
    } catch (error) {
      rmSync(file, { force: true });
      if (attempt >= 3) throw error;
      await sleep(1500);
    }
  }
  const { stdout } = await execFileP(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  audio[key] = { file, dur: Number.parseFloat(stdout) };
}

async function startServer(): Promise<void> {
  const bundle = join(root, 'apps', 'server', 'dist', 'server.mjs');
  if (!existsSync(bundle))
    execFileSync('pnpm', ['--filter', '@yys/server', 'build'], { cwd: root, stdio: 'ignore' });
  serverDir = mkdtempSync(join(tmpdir(), 'yys-demo-server-'));
  mkdirSync(join(serverDir, 'tls'));
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-days', '2', '-subj', '/CN=yiyeshuzhan', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', join(serverDir, 'tls', 'server.key'), '-out', join(serverDir, 'tls', 'server.crt'),
    ],
    { stdio: 'ignore' },
  );
  server = spawn(process.execPath, [bundle], {
    env: {
      ...process.env,
      YYS_DATA_DIR: serverDir,
      YYS_HOST: '127.0.0.1',
      YYS_PORT: '0',
      YYS_ADMIN_PASSWORD: 'Server-Admin-2026',
      YYS_SERVER_NAME: '中山大学图书馆 · 一页书展服务器',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  serverUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 20_000);
    server!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const found = /已启动：(https:\/\/[\d.]+:\d+)/.exec(output)?.[1];
      if (found && /证书指纹/.test(output)) {
        clearTimeout(timer);
        resolve(found);
      }
    });
  });
}

// ---------- 叠加层与鼠标 ----------
const demo = (fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([name, list]) =>
      (window as unknown as { __demo: Record<string, (...a: unknown[]) => void> }).__demo[name]!(
        ...(list as unknown[]),
      ),
    [fn, args] as const,
  );
async function ensureOverlay(): Promise<void> {
  const ok = await page.evaluate(() => Boolean((window as unknown as { __demo?: unknown }).__demo));
  if (!ok) await page.evaluate(installDemoOverlay);
}

let mx = W / 2;
let my = H / 2;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function moveTo(x: number, y: number, ms?: number): Promise<void> {
  const dist = Math.hypot(x - mx, y - my);
  const dur = ms ?? Math.min(1000, Math.max(320, dist * 0.9));
  const steps = Math.max(10, Math.round(dur / 20));
  const sx = mx;
  const sy = my;
  for (let i = 1; i <= steps; i++) {
    const e = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
    await sleep((dur / steps) * 0.6);
  }
  mx = x;
  my = y;
}
async function box(loc: Locator, timeout = 20_000) {
  await loc.scrollIntoViewIfNeeded({ timeout });
  const b = await loc.boundingBox({ timeout });
  if (!b) throw new Error(`元素不可见：${loc}`);
  return b;
}
async function hover(loc: Locator, ms?: number): Promise<void> {
  const b = await box(loc);
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, ms);
}
async function click(loc: Locator, pause = 260): Promise<void> {
  await hover(loc);
  await sleep(140);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(pause);
}
async function type(loc: Locator, text: string, delay = 55): Promise<void> {
  await click(loc, 120);
  await loc.pressSequentially(text, { delay });
}
async function fill(loc: Locator, text: string): Promise<void> {
  await click(loc, 80);
  await loc.fill(text);
  await sleep(150);
}
/** 框选重点并把指针移到旁边；元素找不到时跳过，不中断录制 */
async function focus(loc: Locator, label = '', move = true): Promise<void> {
  try {
    const b = await box(loc, 4000);
    if (move) await moveTo(Math.min(b.x + b.width - 10, b.x + b.width * 0.75), b.y + b.height / 2);
    await demo('focus', b, label);
  } catch {
    // 演示用的强调，找不到元素时忽略
  }
}
async function focusBox(b: { x: number; y: number; width: number; height: number }, label = '') {
  await demo('focus', b, label);
}
const unfocus = () => demo('clear');
async function wheel(dy: number, steps = 8): Promise<void> {
  await unfocus();
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(45);
  }
  await sleep(350);
}

/** 一句旁白：开始时记下时间并显示字幕，同时执行操作；旁白读完、操作也完成后再进入下一句 */
async function say(key: Key, action?: () => Promise<void>, tail = 280): Promise<void> {
  await ensureOverlay();
  const a = audio[key];
  const t0 = Date.now();
  beats.push({ key, text: N[key], t: t0 - recStart, file: a.file, dur: a.dur });
  await demo('caption', N[key]);
  if (action) await action();
  const left = t0 + a.dur * 1000 + tail - Date.now();
  if (left > 0) await sleep(left);
}
async function chapter(name: string, kicker: string, title: string, sub = '', hold = 2600) {
  chapters.push({ name, t: Date.now() - recStart });
  await ensureOverlay();
  await demo('caption', '');
  await unfocus();
  await demo('badge', '');
  await demo('chapter', kicker, title, sub, []);
  await sleep(hold);
  await demo('hideChapter');
  await demo('badge', name);
  await sleep(500);
}

// ---------- 应用操作 ----------
const nav = (name: string) =>
  page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}`) });
const dialog = () => page.getByRole('dialog');
const userButton = (account: Account) =>
  page.getByRole('button', { name: new RegExp(`^${account.name.slice(0, 1)} ${account.name}`) });

async function register(account: Account, visible: boolean): Promise<void> {
  await click(userButton(current!));
  await click(page.getByRole('menuitem', { name: '登录其他账号…' }));
  const d = dialog();
  await click(d.getByRole('button', { name: '注册', exact: true }));
  const put = (loc: Locator, text: string) => (visible ? type(loc, text, 45) : fill(loc, text));
  await put(d.getByLabel('用户名'), account.username);
  await fill(d.getByLabel('密码', { exact: true }), account.password);
  await fill(d.getByLabel('确认密码'), account.password);
  await put(d.getByLabel('姓名'), account.name);
  await put(d.getByLabel('学号 / 工号'), account.no);
  await fill(
    d.getByLabel('学院 / 部门（可选）'),
    account === accounts.curator ? '信息管理学院' : '图书馆阅读推广部',
  );
  await click(d.getByLabel(/记住密码/));
  await click(d.getByRole('button', { name: '注册并登录' }), 500);
  await expect(userButton(account)).toBeVisible();
  current = account;
}

async function actAs(account: Account): Promise<void> {
  if (current === account) return;
  await click(userButton(current!));
  await click(page.getByRole('menuitem', { name: new RegExp(account.name) }), 500);
  await expect(userButton(account)).toBeVisible();
  current = account;
}

async function openExhibition(): Promise<void> {
  await click(nav('策展'));
  await click(page.getByRole('button', { name: /真假之间/ }).first(), 600);
}

test.beforeAll(async () => {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(AUDIO, { recursive: true });
  const keys = Object.keys(N) as Key[];
  for (let i = 0; i < keys.length; i += 4) await Promise.all(keys.slice(i, i + 4).map(synth));
  await startServer();

  userDataDir = mkdtempSync(join(tmpdir(), 'yys-demo-video-'));
  app = await electron.launch({
    args: [
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      join(import.meta.dirname, '..', 'out', 'main', 'index.js'),
    ],
    env: {
      ...process.env,
      YYS_USER_DATA_DIR: userDataDir,
      YYS_E2E_SCRIPTED_MODEL: 'demo',
      YYS_DEMO_ARTWORK: artwork,
      YYS_DEMO_MODEL_DELAY_MS: '1800',
      NODE_ENV: 'production',
    },
  });
  page = await app.firstWindow();
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setContentSize(width!, height!);
      win.center();
      win.webContents.setBackgroundThrottling(false);
      win.show();
      win.focus();
    },
    [W, H],
  );
  await expect(page.getByRole('heading', { name: '还没有上线的书展' })).toBeVisible();
  await page.waitForTimeout(800);
});

test.afterAll(async () => {
  await cdp?.send('Page.stopScreencast').catch(() => undefined);
  const end = Date.now() - recStart;
  writeFileSync(
    join(OUT, 'timeline.json'),
    JSON.stringify({ width: 1920, height: 1080, end, frames, beats, chapters }, null, 1),
  );
  await app?.close();
  server?.kill('SIGTERM');
  if (serverDir) rmSync(serverDir, { recursive: true, force: true });
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('录制演示视频', async () => {
  await page.evaluate(installDemoOverlay);
  await page.mouse.move(mx, my);
  await demo(
    'chapter',
    '参赛作品 · 个人组杨斯然',
    '一页书展',
    '高校图书馆 AI 策展与运营智能体',
    ['赛道1 - 大学生AI创新创业 · 大学生OPC创新创业AI agent'],
  );
  await sleep(400);

  cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const f = join(FRAMES, `${String(frameNo++).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ t: Date.now() - recStart, f });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  recStart = Date.now();
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });

  // ================= 一、作品概述 =================
  chapters.push({ name: '一、作品概述', t: 0 });
  await sleep(1200);
  await say('c1_title', undefined, 600);
  await demo('hideChapter');
  await demo('badge', '一、作品概述');
  await sleep(700);

  const main = page.locator('main');
  await say('c1_pain', async () => {
    await focus(main.getByRole('heading', { name: '还没有上线的书展' }), '一页书展');
    await sleep(1800);
    const intro = main.getByText(/一页书展帮助/);
    const b = await box(intro);
    await unfocus();
    for (let i = 0; i <= 3; i++) {
      await moveTo(b.x + b.width * (0.1 + 0.27 * i), b.y + b.height * (0.3 + 0.2 * (i % 2)), 900);
      await sleep(900);
    }
  });

  const steps = ['需求', '策展', '核对', '申请书', '立项审批', '海报与活动包', '上线审批', '上线与反馈', '复盘'];
  await say('c1_flow', async () => {
    const per = (audio.c1_flow.dur * 1000 - 600) / steps.length;
    for (const [i, name] of steps.entries()) {
      const tile = main.getByText(name, { exact: true }).locator('xpath=..');
      const started = Date.now();
      await focus(tile, `第 ${i + 1} 步`);
      const left = per - (Date.now() - started);
      if (left > 0) await sleep(left);
    }
  });

  await say('c1_feat', async () => {
    await unfocus();
    const first = await box(main.getByText('需求', { exact: true }).locator('xpath=..'));
    const last = await box(main.getByText('复盘', { exact: true }).locator('xpath=..'));
    const hero = await box(main.getByRole('heading', { name: '还没有上线的书展' }).locator('xpath=..'));
    await moveTo(hero.x + hero.width * 0.6, hero.y + hero.height * 0.55);
    await focusBox(
      { x: hero.x, y: hero.y, width: last.x + last.width - hero.x, height: last.y + last.height - hero.y },
      '本地优先 · 自带密钥 · 只从书库选书',
    );
    await sleep(audio.c1_feat.dur * 500);
    await moveTo(first.x + first.width / 2, first.y + first.height / 2);
  });
  await say('c1_next', async () => {
    await unfocus();
    await hover(page.getByRole('button', { name: '登录 / 注册' }));
  });

  // ================= 二、核心功能演示 =================
  await chapter('二、核心功能演示', '第二部分', '核心功能操作演示', '典型场景：为大一新生办一期主题书展');

  await say('c2_login', async () => {
    await click(page.getByRole('button', { name: '登录 / 注册' }), 500);
    await focus(dialog().getByText('初始密码'), '内置超级管理员');
    await sleep(900);
    await unfocus();
    await click(dialog().getByRole('button', { name: '填入' }));
    await click(dialog().getByLabel(/记住密码/));
    await click(dialog().getByRole('button', { name: '登录', exact: true }), 600);
    await expect(userButton(accounts.admin)).toBeVisible();
    current = accounts.admin;
  });

  await say('c2_pwd', async () => {
    await focus(page.getByText('超级管理员仍在使用初始密码，请尽快修改。'), '安全提醒');
    await sleep(800);
    await unfocus();
    await click(page.getByRole('button', { name: /^设置/ }), 500);
    await fill(page.getByLabel('原密码'), accounts.admin.password);
    await fill(page.getByLabel('新密码'), 'Library-2026');
    await click(page.getByRole('button', { name: '修改密码' }).last(), 500);
    await expect(page.getByText('超级管理员仍在使用初始密码，请尽快修改。')).toHaveCount(0);
  });

  await say('c2_provider', async () => {
    await click(page.getByRole('button', { name: '模型与密钥' }), 500);
    await click(page.getByRole('button', { name: '添加服务商' }).first(), 600);
    const names = [/DeepSeek/, /通义千问/, /Kimi/, /智谱/, /豆包/, /MiniMax/, /OpenAI/, /Gemini/, /Ollama/];
    for (const name of names) {
      await focus(dialog().getByRole('button', { name }), '', true);
      await sleep(320);
    }
    await unfocus();
  });

  await say('c2_key', async () => {
    await click(dialog().getByRole('button', { name: /DeepSeek/ }), 500);
    await type(dialog().getByPlaceholder('sk-…'), 'sk-demo-7f3a9c1e5b2d', 28);
    await focus(dialog().getByPlaceholder('sk-…'), '密钥加密保存');
    await sleep(700);
    await unfocus();
    await type(dialog().getByPlaceholder(/手动填写模型名称/), 'deepseek-chat', 40);
    await click(dialog().getByRole('button', { name: '添加', exact: true }));
    await click(dialog().getByText('共享给全部用户'));
    await focus(dialog().getByText('共享给全部用户'), '超级管理员可共享');
    await sleep(900);
    await unfocus();
    await click(dialog().getByRole('button', { name: '保存', exact: true }), 600);
    await expect(page.getByText('全员共享', { exact: true })).toBeVisible();
  });

  await say('c2_image', async () => {
    await click(page.getByRole('button', { name: '添加服务商' }).first(), 600);
    await click(dialog().getByRole('button', { name: /MiniMax/ }), 600);
    await focus(dialog().getByText('image-01', { exact: true }), '自动带出生图模型');
    await sleep(1100);
    await unfocus();
    await type(dialog().getByPlaceholder('sk-…'), 'sk-demo-minimax-6c2e', 28);
    await click(dialog().getByText('共享给全部用户'));
    await click(dialog().getByRole('button', { name: '保存', exact: true }), 700);
    await expect(page.getByText('全员共享', { exact: true })).toHaveCount(2);
  });

  await say('c2_roles', async () => {
    const heading = page.getByText('模型分工', { exact: true });
    await heading.scrollIntoViewIfNeeded();
    await sleep(400);
    await focus(page.getByLabel('主模型').first(), '主模型：选书与写作');
    await sleep(audio.c2_roles.dur * 400);
    await focus(page.getByLabel('模型', { exact: true }), '生图模型：MiniMax image-01');
  });

  await say('c2_register', async () => {
    await unfocus();
    await register(accounts.curator, true);
  });
  await say('c2_reviewer', () => register(accounts.reviewer, false), 200);
  await say('c2_admin_role', async () => {
    await actAs(accounts.admin);
    await click(nav('管理'), 600);
    const select = page.getByLabel(`${accounts.reviewer.name} 的角色`);
    await hover(select);
    await select.selectOption('approver');
    await expect(page.getByText('角色已更新')).toBeVisible();
    await focus(select, '审批管理员');
    await sleep(900);
    await unfocus();
  });

  await say('c2_library', async () => {
    await click(nav('书库'), 700);
    await expect(page.getByText('共 28 本')).toBeVisible();
    await focus(page.getByText('共 28 本'), '国图著录 · 真实索书号');
  });
  await say('c2_library_detail', async () => {
    await unfocus();
    const row = page.getByRole('button', { name: /思考，快与慢/ }).first();
    await click(row, 700);
    await expect(page.getByText('中图分类：F069.9-49')).toBeVisible();
    await focus(page.getByText('中图分类：F069.9-49'), '中图分类号');
    await sleep(1500);
    await wheel(320);
    await focus(page.getByText(/索书号/).last(), '索书号');
    await sleep(1200);
    await unfocus();
    await click(row, 400);
  });
  await say('c2_shelf', async () => {
    await click(page.getByRole('button', { name: '书架' }), 900);
    const card = page.getByRole('button', { name: /大数据时代/ }).first();
    await hover(card);
    await sleep(900);
    await hover(page.getByRole('button', { name: /乡土中国/ }).first());
    await sleep(700);
    await click(page.getByRole('button', { name: '列表' }), 400);
    await click(page.getByRole('button', { name: /导入书目/ }), 500);
    await focus(page.getByRole('menu'), 'Excel / CSV / TXT / JSON');
    await sleep(1400);
    await unfocus();
    await page.keyboard.press('Escape');
  });

  await say('c2_brief', async () => {
    await actAs(accounts.curator);
    await click(nav('策展'), 500);
    await click(page.getByRole('button', { name: '发起策展' }).first(), 600);
    const d = dialog();
    await type(d.getByLabel('主题'), '新生如何识别 AI 生成的信息', 70);
    await type(d.getByLabel('目标读者'), '大一新生', 60);
    await fill(d.getByLabel('活动日期'), '2026-11-15');
    await fill(d.getByLabel('活动时间'), '14:00–15:00');
    await type(d.getByLabel('场地'), '图书馆一楼大厅', 50);
    await fill(d.getByLabel('期望书目数量'), '8');
    await type(d.getByLabel('特殊要求（可选）'), '兼顾经典与新书，篇幅适中', 45);
  });

  await say('c2_agent', async () => {
    await click(dialog().getByRole('button', { name: '创建并开始策展' }), 800);
    await focus(page.getByText('智能体运行'), '实时进度');
    await expect(page.getByText('核对清单', { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('策展完成：8 本书')).toBeVisible({ timeout: 60_000 });
    await unfocus();
  });

  await say('c2_review', async () => {
    await focus(page.getByText('策展完成：8 本书'), '只从书库选书');
    await sleep(1600);
    await focus(page.getByText(/需要核对|必须处理/).first(), '需要人工确认');
    await sleep(1600);
    await wheel(380);
    await focus(page.getByText(/缺少索书号|示例书库/).first(), '核对项');
  });
  await say('c2_review_edit', async () => {
    await focus(page.getByRole('button', { name: '替换' }).first(), '一键替换');
    await sleep(1600);
    await unfocus();
    await click(page.getByRole('button', { name: '确认无误，生成策展申请书' }), 600);
  });

  await say('c2_proposal', async () => {
    await expect(page.getByText('主题书展策展申请书')).toBeVisible({ timeout: 60_000 });
    await focus(page.getByText('主题书展策展申请书'), '正式格式');
    await sleep(1500);
    await wheel(420);
    await sleep(900);
    await wheel(420);
    await sleep(900);
    await click(page.getByRole('button', { name: '提交立项审批' }), 600);
    await expect(page.getByText('立项审批中').first()).toBeVisible();
  });

  await say('c2_approve', async () => {
    await actAs(accounts.reviewer);
    await click(nav('审批'), 500);
    await click(page.getByRole('button', { name: /立项审批.*真假之间/ }), 700);
    await type(page.getByPlaceholder(/填写意见/), '选题贴合新生需求，书目选择合理，同意立项。', 40);
    await click(page.getByRole('button', { name: '同意', exact: true }), 600);
    await expect(page.getByText('立项审批：同意', { exact: true })).toBeVisible();
  });

  await say('c2_package', async () => {
    await actAs(accounts.curator);
    await openExhibition();
    await click(page.getByRole('button', { name: /立项审批/ }), 400);
    await click(page.getByRole('button', { name: '生成海报与完整活动包' }), 600);
    await expect(page.getByRole('button', { name: '导出 PNG' })).toBeVisible({ timeout: 90_000 });
  });

  await say('c2_poster', async () => {
    await click(page.getByRole('button', { name: '国风水墨' }));
    await click(page.getByRole('button', { name: 'AI 绘制画面' }), 400);
    await expect(page.getByRole('button', { name: '使用这张画面' })).toHaveCount(1, {
      timeout: 60_000,
    });
    await sleep(900);
    const poster = page.getByRole('img', { name: /^海报：/ }).first();
    await poster.scrollIntoViewIfNeeded();
    await sleep(500);
    await focus(poster, 'AI 画面 + 模板排版文字');
  });

  await say('c2_materials', async () => {
    await unfocus();
    await page.getByText('推文', { exact: false }).first().scrollIntoViewIfNeeded();
    await sleep(500);
    await focus(page.getByText('推文', { exact: false }).first(), '推文 · 报名 · 通知 · 问卷');
    await sleep(1500);
    await wheel(500);
  });

  await say('c2_publish', async () => {
    await click(page.getByRole('button', { name: '提交上线审批' }), 600);
    await expect(page.getByText('上线审批中').first()).toBeVisible();
    await actAs(accounts.reviewer);
    await click(nav('审批'), 500);
    await click(page.getByRole('button', { name: /上线审批.*真假之间/ }), 600);
    await fill(page.getByPlaceholder(/填写意见/), '海报与活动材料完整，同意上线。');
    await click(page.getByRole('button', { name: '同意', exact: true }), 600);
    await expect(page.getByText('上线审批：同意', { exact: true }).first()).toBeVisible();
  });

  // ================= 三、用户交互过程与成效 =================
  await chapter('三、交互与成效', '第三部分', '用户交互过程与成效', '首页展示 · 反馈复盘 · 团队协作');

  await say('c3_home', async () => {
    await click(nav('首页'), 900);
    await expect(page.getByText('最新一期', { exact: true })).toBeVisible();
    const poster = page.getByRole('img', { name: /^海报：/ });
    const b = await box(poster);
    await moveTo(b.x + b.width * 0.2, b.y + b.height * 0.3);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      await moveTo(
        b.x + b.width * (0.15 + 0.7 * t),
        b.y + b.height * (0.25 + 0.5 * Math.sin(t * Math.PI)),
        110,
      );
    }
  });

  await say('c3_book', async () => {
    const bookCard = page.getByRole('button', { name: /《思考，快与慢》/ }).last();
    await moveTo(W * 0.55, H * 0.6);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 180);
      await sleep(160);
    }
    await bookCard.scrollIntoViewIfNeeded();
    await click(bookCard, 700);
    await expect(dialog().getByText('本期导读')).toBeVisible();
    await focus(dialog().getByText('本期导读'), '导读与入选理由');
    await sleep(1800);
    await unfocus();
    await click(dialog().getByRole('button', { name: '关闭' }), 300);
  });

  await say('c3_feedback', async () => {
    await actAs(accounts.curator);
    await openExhibition();
    await click(page.getByRole('button', { name: /上线与反馈/ }), 500);
    await type(page.getByLabel('参与人数'), '36', 120);
    await click(page.getByRole('button', { name: '保存', exact: true }), 400);
    const box2 = page.getByPlaceholder(/每行一条反馈/);
    await fill(
      box2,
      [
        '5 辨析环节很有意思，第一次知道 AI 生成的图片可以这样查',
        '4分：希望多给一些动手练习的时间',
        '5 想借《思考，快与慢》，现场就办好了借阅',
        '4 海报上的活动时间有点小，差点没注意到',
        '5 三个展区的顺序很清楚，从认识信息到判断信息',
      ].join('\n'),
    );
    await focus(box2, '评分 + 反馈，自动脱敏');
    await sleep(1200);
    await unfocus();
    await click(page.getByRole('button', { name: '录入反馈' }), 500);
  });

  await say('c3_retro', async () => {
    await click(page.getByRole('button', { name: '前往复盘' }), 500);
    await click(page.getByRole('button', { name: '生成复盘总结' }), 500);
    await expect(page.getByText('给下一期的建议（每行一条）')).toBeVisible({ timeout: 60_000 });
    await focus(page.getByText('给下一期的建议（每行一条）'), '自动成为下次策展参考');
  });

  await say('c3_results', async () => {
    await unfocus();
    await click(nav('首页'), 800);
    const results = page.getByText('活动成果', { exact: true }).first();
    await moveTo(W * 0.55, H * 0.6);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 220);
      await sleep(140);
    }
    await results.scrollIntoViewIfNeeded();
    await sleep(600);
    await expect(page.getByText('36', { exact: true })).toBeVisible();
    await focus(page.getByText('36', { exact: true }), '参与人数');
    await sleep(1400);
    await focus(page.getByText(/平均评分/).first(), '读者评分');
  });

  await say('c3_server', async () => {
    await unfocus();
    await click(userButton(current!));
    await click(page.getByRole('menuitem', { name: '退出登录' }), 500);
    current = null;
    await click(page.getByRole('button', { name: '登录 / 注册' }), 500);
    await click(dialog().getByRole('button', { name: '更改' }), 500);
    await click(page.getByRole('radio', { name: /团队服务器/ }), 300);
    await type(page.getByPlaceholder('https://'), serverUrl, 30);
    await click(page.getByRole('button', { name: '测试连接' }), 500);
    await expect(page.getByText('证书指纹（SHA-256）')).toBeVisible({ timeout: 20_000 });
    await focus(page.getByText('证书指纹（SHA-256）').locator('xpath=..'), '逐段核对证书指纹');
  });

  await unfocus();
  await demo('caption', '');
  await demo('badge', '');
  chapters.push({ name: '结束', t: Date.now() - recStart });
  await demo('chapter', '一页书展', '让每一期书展有据可查', '', [
    '九步闭环 · 只从书库选书 · 两级审批留痕',
    'AI 海报画面 + 模板排版 · 推文通知问卷一键生成',
    'macOS / Windows · 本机或团队服务器 · 自带模型密钥',
  ]);
  await sleep(700);
  await say('c3_close', undefined, 1600);
});
