import type { ScriptHandler } from './testing';

/**
 * 演示用脚本：为“新生如何识别 AI 生成的信息”主题给出接近真实模型的回答，
 * 用于生成 README 与使用手册中的截图（不调用任何模型服务）。
 */

const mainTitle = (title: string): string => title.split(/[：:（(]/)[0]!.trim();

const books: Record<string, { section: number; reason: string; guide: string }> = {
  智人之上: {
    section: 0,
    reason: '从信息网络的历史讲到人工智能，帮助新生建立对“信息”的整体认识，适合作为书展开篇。',
    guide:
      '赫拉利把人类历史讲成一部信息网络史：从故事、文书到算法，信息从来不只是“真相”的搬运工。读完你会明白，AI 时代真正的挑战不是信息太少，而是我们如何在海量信息中保持自己的判断。',
  },
  智能革命: {
    section: 0,
    reason: '从产业一线讲解人工智能如何进入搜索、推荐与内容生成，让读者看清信息背后的技术逻辑。',
    guide:
      '这本书从一线视角讲述人工智能如何走进搜索、出行与日常生活。读完你能看清 AI 推荐与生成背后的技术逻辑，也会开始追问：屏幕上的答案，是谁、用什么方式算出来的？',
  },
  大数据时代: {
    section: 0,
    reason:
      '用大量案例说明数据与算法如何影响决策，同时讨论隐私与偏见，帮助读者理解“算法为什么懂我”。',
    guide:
      '一本让人重新理解“数据”的入门书。作者用大量案例说明，相关关系正在改变我们做决定的方式，同时也带来隐私与偏见的新问题。适合想弄懂“算法为什么这么懂我”的同学。',
  },
  '思考，快与慢': {
    section: 1,
    reason: '解释直觉判断为何容易出错，是理解“我们为什么会被误导”的核心读物。',
    guide:
      '卡尼曼告诉我们，大脑里有“快思考”和“慢思考”两套系统。很多被误导的时刻，都是快思考抢先替我们下了结论。学会在关键时刻慢下来，是辨别信息真伪的第一步。',
  },
  浅薄: {
    section: 1,
    reason: '讨论互联网阅读方式对注意力与深度思考的影响，提醒新生留意自己的信息习惯。',
    guide:
      '当我们习惯了刷屏和跳读，深度思考的能力也在悄悄变化。作者结合神经科学与阅读史，提醒我们留意互联网对注意力的影响。读它，也是给自己一次重新专注阅读的机会。',
  },
  统计数字会撒谎: {
    section: 1,
    reason: '用风趣的例子拆解图表与百分比的常见误导手法，篇幅短，适合新生快速上手。',
    guide:
      '一张图表、一个百分比，就足以让人信以为真。这本经典小书用风趣的例子拆解常见的统计“花招”，薄薄一本，读完就能在新闻和朋友圈里一眼看出数字背后的问题。',
  },
  学会提问: {
    section: 2,
    reason: '提供一套可操作的批判性提问清单，可以直接用在每天看到的消息上。',
    guide:
      '批判性思维的入门首选。书中给出一套可操作的提问清单：论点是什么？证据可靠吗？有没有被忽略的信息？把这些问题用在每一条热搜上，你会成为更清醒的读者。',
  },
  对伪心理学说不: {
    section: 2,
    reason: '讲解可证伪性、相关与因果等概念，帮助读者识别“听起来很科学”的说法。',
    guide:
      '为什么“专家说”“我朋友亲身经历”并不等于证据？作者用心理学的例子讲解可证伪性、相关与因果等概念，帮你识别那些听起来很科学、其实经不起推敲的说法。',
  },
};

const preferred = Object.keys(books);
const sections = [
  { title: '信息从哪里来', intent: '了解信息网络、数据与算法如何生产和分发我们看到的内容' },
  { title: '我们为什么会被误导', intent: '认识直觉、注意力与数字呈现方式带来的判断偏差' },
  { title: '练就辨别真假的眼睛', intent: '掌握提问与核实的方法，形成自己的判断' },
];

/** 从提示词的书目清单（b1｜《书名》｜…）中取出编号与书名 */
const listing = (prompt: string): { ref: string; title: string }[] =>
  [...prompt.matchAll(/^(b\d+)｜《([^》]+)》/gm)].map((m) => ({ ref: m[1]!, title: m[2]! }));

const known = (title: string) => books[mainTitle(title)];

export const demoScript: Record<string, ScriptHandler> = {
  keywords: () => ({ keywords: ['人工智能', '信息', '算法', '批判性思维', '数据', '认知偏差'] }),
  select: (prompt) => {
    const items = listing(prompt);
    const count = Number(/请选出 (\d+) 本/.exec(prompt)?.[1] ?? 8);
    // 同名书只取一条，避免把重复记录选进书单
    const ranked = [
      ...preferred.flatMap((t) => items.filter((i) => mainTitle(i.title) === t).slice(0, 1)),
      ...items.filter((i) => !known(i.title)),
    ];
    return {
      selections: ranked.slice(0, count).map((item) => ({
        ref: item.ref,
        reason: known(item.title)?.reason ?? `《${item.title}》与主题相关，适合作为延伸阅读。`,
        evidence: ['title', 'subjects', 'summary'],
        confidence: known(item.title) ? 'high' : 'medium',
      })),
      alternates: ranked.slice(count, count + 3).map((item) => ({
        ref: item.ref,
        reason: '主题相关，可在书目缺货时替换',
      })),
    };
  },
  structure: (prompt) => {
    const items = listing(prompt);
    return {
      title: '真假之间',
      subtitle: 'AI 时代的读信息指南',
      sections: sections.map((section, index) => ({
        ...section,
        refs: items
          .filter((item, i) => (known(item.title)?.section ?? i % sections.length) === index)
          .map((item) => item.ref),
      })),
      statement: {
        goals: '帮助新生建立信息辨别意识，掌握核实信息的基本方法，并带着问题走进图书馆。',
        audienceNote: '刚进入大学、每天大量接触网络信息与 AI 工具的新生',
        structureLogic: '从“信息如何产生”到“我们为何被误导”，再落到“如何核实”，层层递进。',
        selectionLogic: '优先选择入门友好、篇幅适中、馆藏充足的图书，兼顾经典与新书。',
      },
    };
  },
  guide: (prompt) => {
    const title = /《([^》]+)》/.exec(prompt)?.[1] ?? '';
    return {
      guide:
        known(title)?.guide ??
        `《${title}》从一个新的角度回应本期主题，语言通俗，适合作为延伸阅读，帮助你在纷繁的信息中多一分清醒。`,
    };
  },
  materials: (prompt) => {
    const count = [...prompt.matchAll(/^(\d+)\. /gm)].length || sections.length;
    const panelTexts = [
      '我们每天读到的新闻、刷到的视频，背后都有一张看不见的信息网络：平台的推荐、数据的积累、AI 的生成。了解信息从哪里来，是判断它是否可信的起点。',
      '被误导往往不是因为不聪明，而是因为大脑偏爱“快”。直觉、碎片化阅读和精心设计的图表，都可能让我们在不知不觉中下结论。认识这些偏差，才能有意识地避开它们。',
      '辨别真假不需要高深的技术，只需要几个好问题：谁说的？证据是什么？还有没有其他解释？带上这些问题，再加一点耐心，你就能成为更清醒的读者。',
    ];
    return {
      introduction:
        'AI 可以在几秒钟内写出一篇新闻、生成一张照片，也可能一本正经地“编造”事实。刚进入大学的你，每天都在和海量信息打交道：哪些可以相信，哪些需要核实？本期一页书展精选 8 本馆藏，分为三个展区——从信息如何被生产和分发讲起，到我们为什么容易被误导，最后落到一套随手可用的核实方法。希望你带着问题来，带着方法走。',
      panels: Array.from({ length: count }, (_, i) => ({
        index: i + 1,
        panelText: panelTexts[i] ?? panelTexts[panelTexts.length - 1]!,
      })),
      activity: {
        format: '主题导览 + 小组辨析',
        segments: [
          {
            minutes: 10,
            title: '展区导览',
            description: '馆员带领参观三个展区，介绍每个展区想回答的问题',
          },
          {
            minutes: 15,
            title: '真假辨析',
            description: '分组拿到三条真假难辨的消息（含 AI 生成内容），用书中的方法查证',
          },
          { minutes: 5, title: '分享与借阅', description: '每组分享查证思路，现场办理借阅' },
        ],
        questions: [
          '你最近一次被一条消息误导，是因为什么？',
          '看到一张“新闻照片”，你会用哪三步核实它？',
          '这 8 本书里，你最想先读哪一本？为什么？',
        ],
      },
    };
  },
  grounding: () => ({ issues: [] }),
  proposal: () => ({
    purpose:
      '面向新生开展信息素养主题阅读推广，帮助新生认识 AI 生成内容与网络信息的特点，掌握核实信息的基本方法，并以书为媒介把新生引入图书馆。',
    format:
      '在图书馆一楼大厅设置主题书架（三个展区、8 本精选馆藏），配合 30 分钟主题导览与小组辨析活动，现场提供借阅。',
    expectedOutcomes:
      '预计参与 30–50 人；参与者能说出至少两种核实信息的方法；展期内展出图书借阅量较平时提升；收集读者反馈用于下一期选题。',
    support:
      '一楼大厅展架两组与展板三块；公众号推送一次；活动当天需 1 名馆员导览、1 名志愿者协助签到。',
  }),
  package: () => ({
    poster: {
      headline: '真假之间',
      subheadline: 'AI 时代的读信息指南',
      tagline: '在信息洪流中，做清醒的读者',
      highlights: ['8 本精选馆藏', '30 分钟导览', '真假案例辨析'],
      callToAction: '扫码报名',
    },
    promotion: {
      postTitle: '一页书展｜真假之间：AI 时代的读信息指南',
      postBody:
        '一张“现场照片”可能是 AI 生成的，一段“专家解读”可能张冠李戴。每天被信息包围的我们，怎样才能不被带偏？\n\n本期一页书展从图书馆精选 8 本好书，分为“信息从哪里来”“我们为什么会被误导”“练就辨别真假的眼睛”三个展区：从赫拉利的《智人之上》读懂信息网络，从卡尼曼的《思考，快与慢》看见自己的思维偏差，再用《学会提问》练出一套随手可用的核实方法。\n\n11 月 15 日下午，馆员将带你逛展区，并和大家一起辨析几条真假难辨的消息。读完一本书，多一分清醒。',
      signupIntro:
        '活动时间：11 月 15 日 14:00–15:00\n活动地点：图书馆一楼大厅\n活动内容：主题导览 + 真假案例辨析，现场可直接借阅展出图书\n名额 50 人，扫码报名，先到先得。',
      notice:
        '各位同学：图书馆将于 11 月 15 日 14:00 在一楼大厅举办“真假之间——AI 时代的读信息指南”主题书展导览活动，欢迎新生踊跃参加。展期为 11 月 10 日至 11 月 30 日，展出图书可现场借阅。',
    },
    feedbackQuestions: [
      '你对本次书展的整体评价（1–5 分）？',
      '哪个展区或哪本书对你最有帮助？',
      '你希望下一期书展关注什么主题？',
    ],
  }),
  retrospective: () => ({
    summary:
      '本期书展共 36 人参与导览，读者平均评分 4.5 分。真假案例辨析环节最受欢迎，《思考，快与慢》《学会提问》借阅最多；部分读者反映海报上的活动时间不够醒目，希望增加更多动手练习。',
    worked: [
      '用真实消息做辨析，参与度明显高于单纯讲解',
      '三个展区层层递进，读者容易理解书展的逻辑',
      '现场借阅降低了“想读但没去借”的门槛',
    ],
    improve: [
      {
        target: '海报',
        issue: '活动时间与地点字号偏小',
        suggestion: '放大时间地点，并加入报名截止日期',
      },
      {
        target: '活动流程',
        issue: '辨析环节时间偏紧',
        suggestion: '导览压缩到 8 分钟，辨析延长到 18 分钟',
      },
    ],
    audienceInsights: ['新生对“如何核实 AI 生成图片”最感兴趣', '多数读者希望拿到可带走的核实清单'],
    nextTime: [
      '制作一页“信息核实清单”随书发放',
      '邀请新闻学院老师参与辨析环节',
      '下一期可尝试“数据素养”主题',
    ],
  }),
  rewrite: () => ({ text: '按要求改写后的内容。' }),
  art_prompt: () => ({
    prompt:
      'A quiet university library at dusk in ink-wash style, a student holding a glowing open book, paper cranes and shards of light rising, teal and amber palette, calm misty sky in the upper third',
  }),
};
