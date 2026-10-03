import { crc32, deflateSync } from 'node:zlib';
import { MockLanguageModelV4 } from 'ai/test';

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
export type ScriptHandler = (prompt: string, call: number) => unknown;

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
} as GenerateResult['usage'];

function textOf(options: CallOptions): { task: string; prompt: string } {
  let system = '';
  let prompt = '';
  for (const message of options.prompt) {
    const content = message.content as string | { type: string; text?: string }[];
    const text =
      typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('');
    if (message.role === 'system') system += text;
    else prompt += text;
  }
  return { task: /【任务：(\w+)】/.exec(system)?.[1] ?? 'unknown', prompt };
}

const refsIn = (prompt: string): string[] => [...prompt.matchAll(/^(b\d+)｜/gm)].map((m) => m[1]!);

const defaults: Record<string, ScriptHandler> = {
  keywords: () => ({ keywords: ['人工智能', '算法', '批判性思维', '信息'] }),
  select: (prompt) => {
    const refs = refsIn(prompt);
    const count = Number(/请选出 (\d+) 本/.exec(prompt)?.[1] ?? 8);
    return {
      selections: refs.slice(0, count).map((ref) => ({
        ref,
        reason: `${ref} 与主题密切相关，适合目标读者入门阅读。`,
        evidence: ['title', 'subjects', 'summary'],
        confidence: 'high',
      })),
      alternates: refs.slice(count, count + 3).map((ref) => ({ ref, reason: '可作为备选' })),
    };
  },
  structure: (prompt) => {
    const refs = refsIn(prompt);
    const half = Math.ceil(refs.length / 2);
    return {
      title: '真假之间',
      subtitle: 'AI 时代的读信息指南',
      sections: [
        { title: '信息从哪里来', intent: '理解信息的生产与传播方式', refs: refs.slice(0, half) },
        { title: '如何判断真假', intent: '掌握识别与核实信息的方法', refs: refs.slice(half) },
      ],
      statement: {
        goals: '提升新生的信息辨别能力',
        audienceNote: '刚进入大学的新生',
        structureLogic: '从认识信息到判断信息',
        selectionLogic: '优先选择入门友好的馆藏',
      },
    };
  },
  guide: () => ({
    guide:
      '这本书用通俗的语言帮助读者理解主题中的关键问题，适合作为入门读物，读完后能更从容地面对复杂信息。',
  }),
  materials: (prompt) => {
    const sections = [...prompt.matchAll(/^(\d+)\. /gm)].length;
    return {
      introduction:
        '在信息爆炸的时代，学会辨别信息是每位大学生的必修课。本次书展从信息的来源讲起，带你一步步掌握判断信息真伪的方法。',
      panels: Array.from({ length: sections }, (_, i) => ({
        index: i + 1,
        panelText: `第 ${i + 1} 展区的展板短文。`,
      })),
      activity: {
        format: '主题导览 + 小组讨论',
        segments: [
          { minutes: 10, title: '导览', description: '馆员带领参观展区' },
          { minutes: 15, title: '讨论', description: '分组讨论一个真实案例' },
          { minutes: 5, title: '总结', description: '分享收获' },
        ],
        questions: ['你最近一次被误导是什么时候？', '你会如何核实一条消息？', '哪本书最想借阅？'],
      },
    };
  },
  grounding: () => ({ issues: [] }),
  proposal: () => ({
    purpose: '帮助新生建立信息辨别意识。',
    format: '主题书架展陈 + 30 分钟导读分享。',
    expectedOutcomes: '参与者掌握基本的信息核实方法。',
    support: '一楼大厅展架两组、公众号推送一次。',
  }),
  package: () => ({
    poster: {
      headline: '真假之间',
      subheadline: 'AI 时代的读信息指南',
      tagline: '在信息洪流中，做清醒的读者',
      highlights: ['10 本精选馆藏', '30 分钟导览', '真实案例讨论'],
      callToAction: '扫码报名',
    },
    promotion: {
      postTitle: '一页书展｜真假之间',
      postBody: '推文正文……',
      signupIntro: '报名介绍……',
      notice: '校园通知……',
    },
    feedbackQuestions: ['你对本次书展的整体评价？', '哪个展区最有收获？', '对下次活动有什么建议？'],
  }),
  retrospective: () => ({
    summary: '本次活动整体反馈良好。',
    worked: ['案例讨论环节参与度高'],
    improve: [{ target: '海报', issue: '活动时间不够醒目', suggestion: '放大时间与地点' }],
    audienceInsights: ['新生希望有更多实操'],
    nextTime: ['增加动手核实练习'],
  }),
  rewrite: () => ({ text: '按要求改写后的内容。' }),
  art_prompt: () => ({
    prompt:
      'A quiet university library at dusk, warm lamps over long wooden tables, a student opening a glowing book from which paper birds and fragments of light fly upward, soft teal and amber palette, calm empty sky in the upper third',
  }),
  rewrite_activity: () => ({
    format: '导览',
    segments: [{ minutes: 30, title: '导览', description: '改写后' }],
    questions: ['问题'],
  }),
  rewrite_statement: () => ({
    goals: '改写后的目标',
    audienceNote: '读者',
    structureLogic: '结构',
    selectionLogic: '选书',
  }),
};

/**
 * 生成一张竖版渐变 PNG（含几个柔和的光斑），作为测试与演示用的“AI 画面”。
 * 不依赖图像库：手写 PNG 编码，像素数据用 zlib 压缩。
 */
export function makeArtworkPng(width = 600, height = 800, seed = 1): Uint8Array {
  const top = [24 + seed * 7, 60, 84];
  const bottom = [214, 150 - seed * 5, 92];
  const spots = [
    { x: 0.7, y: 0.62, r: 0.22, c: [255, 220, 160] },
    { x: 0.3, y: 0.78, r: 0.16, c: [170, 220, 210] },
    { x: 0.55, y: 0.85, r: 0.12, c: [255, 245, 220] },
  ];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = y / height;
      let rgb = top.map((c, i) => c + (bottom[i]! - c) * t);
      for (const s of spots) {
        const d = Math.hypot(x / width - s.x, (y / height - s.y) * (height / width));
        const k = Math.max(0, 1 - d / s.r) ** 2 * 0.55;
        rgb = rgb.map((c, i) => c + (s.c[i]! - c) * k);
      }
      rgb.forEach((c, i) => (raw[row + 1 + x * 3 + i] = Math.max(0, Math.min(255, Math.round(c)))));
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // 位深
  header.writeUInt8(2, 9); // 真彩色 RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** 按任务代号回答的脚本化模型；可按任务覆盖返回值，用于测试校验与重试路径 */
export function createScriptedModel(overrides: Record<string, ScriptHandler> = {}) {
  const calls: { task: string; prompt: string }[] = [];
  const counter = new Map<string, number>();
  const model = new MockLanguageModelV4({
    doGenerate: async (options: CallOptions): Promise<GenerateResult> => {
      const { task, prompt } = textOf(options);
      const n = (counter.get(task) ?? 0) + 1;
      counter.set(task, n);
      calls.push({ task, prompt });
      const handler = overrides[task] ?? defaults[task];
      if (!handler) throw new Error(`脚本模型没有任务 ${task} 的回答`);
      const value = handler(prompt, n);
      return {
        content: [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  return { model, calls };
}
export { demoScript } from './demo-script';
