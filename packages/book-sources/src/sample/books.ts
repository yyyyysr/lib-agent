import { bookFieldKeys, type BookDraft } from '@yys/shared';

type SampleSeed = Omit<BookDraft, 'isSample' | 'provenance'> & { externalId: string };

/**
 * 示例书库：书名与作者为真实中文版图书，来源链接为对应的豆瓣读书页面（可直接打开）；
 * 索书号为虚构示例，统一带“示例-”前缀。
 * 刻意保留的缺陷用于演示核对清单：
 * - sample-0012、sample-0016 缺索书号
 * - sample-0013、sample-0015 缺摘要
 * - sample-0028 与 sample-0003 为同一本书的重复记录
 */
const seeds: SampleSeed[] = [
  // 主题 A：新生如何识别 AI 生成的信息
  {
    externalId: 'sample-0001',
    title: '智人之上：从石器时代到AI时代的信息网络简史',
    authors: ['尤瓦尔·赫拉利'],
    callNumber: '示例-K02/011',
    subjects: ['信息网络', '人工智能', '历史'],
    summary: '从历史视角讨论信息网络如何塑造人类社会，以及人工智能给信息秩序带来的新挑战。',
    sourceUrl: 'https://book.douban.com/subject/37001305/',
  },
  {
    externalId: 'sample-0002',
    title: 'AI 3.0',
    authors: ['梅拉妮·米歇尔'],
    callNumber: '示例-TP18/024',
    subjects: ['人工智能', '机器学习', '科普'],
    summary: '介绍人工智能的发展脉络与能力边界，讨论当前 AI 在理解与常识方面的局限。',
    sourceUrl: 'https://book.douban.com/subject/35351678/',
  },
  {
    externalId: 'sample-0003',
    title: '算法霸权：数学杀伤性武器的威胁',
    authors: ['凯西·奥尼尔'],
    callNumber: '示例-TP18/031',
    subjects: ['算法', '大数据', '社会公平'],
    summary: '通过案例分析不透明的算法模型如何在教育、就业、信贷等领域放大不公平。',
    sourceUrl: 'https://book.douban.com/subject/30295861/',
  },
  {
    externalId: 'sample-0004',
    title: '学会提问',
    authors: ['尼尔·布朗', '斯图尔特·基利'],
    callNumber: '示例-B804/007',
    subjects: ['批判性思维', '论证'],
    summary: '介绍识别论证结构、评估证据与发现推理谬误的提问方法。',
    sourceUrl: 'https://book.douban.com/subject/36648241/',
  },
  {
    externalId: 'sample-0005',
    title: '统计数字会撒谎',
    authors: ['达莱尔·哈夫'],
    callNumber: '示例-C8/019',
    subjects: ['统计', '数据素养'],
    summary: '用通俗案例揭示图表与统计数字被误用、误读的常见方式。',
    sourceUrl: 'https://book.douban.com/subject/3595095/',
  },
  {
    externalId: 'sample-0006',
    title: '事实：用数据思考，避免情绪化决策',
    authors: ['汉斯·罗斯林'],
    callNumber: '示例-C8/027',
    subjects: ['数据素养', '认知偏差'],
    summary: '用全球发展数据说明人们常见的认知偏差，倡导基于事实的世界观。',
    sourceUrl: 'https://book.douban.com/subject/33385402/',
  },
  {
    externalId: 'sample-0007',
    title: '思考，快与慢',
    authors: ['丹尼尔·卡尼曼'],
    callNumber: '示例-B842/015',
    subjects: ['心理学', '决策', '认知偏差'],
    summary: '介绍直觉与理性两种思维系统，以及它们如何导致系统性的判断偏差。',
    sourceUrl: 'https://book.douban.com/subject/10785583/',
  },
  {
    externalId: 'sample-0008',
    title: '娱乐至死',
    authors: ['尼尔·波兹曼'],
    callNumber: '示例-G206/004',
    subjects: ['媒介批评', '传播学'],
    summary: '讨论电视等媒介形式如何改变公共话语的方式与质量。',
    sourceUrl: 'https://book.douban.com/subject/26319730/',
  },
  {
    externalId: 'sample-0009',
    title: '信息简史',
    authors: ['詹姆斯·格雷克'],
    callNumber: '示例-G201/012',
    subjects: ['信息论', '科学史'],
    summary: '梳理从鼓语、文字、电报到信息论的发展历程，解释"信息"概念如何形成。',
    sourceUrl: 'https://book.douban.com/subject/25752043/',
  },
  {
    externalId: 'sample-0010',
    title: '生命3.0',
    authors: ['迈克斯·泰格马克'],
    callNumber: '示例-TP18/042',
    subjects: ['人工智能', '未来学'],
    summary: '探讨通用人工智能可能带来的社会影响，以及人类应如何为此做准备。',
    sourceUrl: 'https://book.douban.com/subject/30262617/',
  },
  {
    externalId: 'sample-0011',
    title: '如何阅读一本书',
    authors: ['莫提默·J. 艾德勒', '查尔斯·范多伦'],
    callNumber: '示例-G792/003',
    subjects: ['阅读方法'],
    summary: '介绍检视阅读、分析阅读与主题阅读等不同层次的阅读方法。',
    sourceUrl: 'https://book.douban.com/subject/1013208/',
  },
  {
    externalId: 'sample-0012',
    title: '乌合之众：大众心理研究',
    authors: ['古斯塔夫·勒庞'],
    subjects: ['社会心理学', '群体'],
    summary: '分析群体心理的特征，以及群体环境对个人判断的影响。',
    sourceUrl: 'https://book.douban.com/subject/1012611/',
  },
  {
    externalId: 'sample-0013',
    title: '噪声',
    authors: ['丹尼尔·卡尼曼', '奥利维耶·西博尼', '卡斯·桑斯坦'],
    callNumber: '示例-B842/033',
    subjects: ['决策', '判断'],
    sourceUrl: 'https://book.douban.com/subject/35541399/',
  },
  // 主题 B：求职季的职业探索阅读
  {
    externalId: 'sample-0014',
    title: '斯坦福大学人生设计课',
    authors: ['比尔·博内特', '戴夫·伊万斯'],
    callNumber: '示例-B821/051',
    subjects: ['职业规划', '设计思维'],
    summary: '运用设计思维的方法探索职业与人生方向，强调原型尝试与迭代。',
    sourceUrl: 'https://book.douban.com/subject/27601926/',
  },
  {
    externalId: 'sample-0015',
    title: '你的降落伞是什么颜色？',
    authors: ['理查德·尼尔森·鲍利斯'],
    callNumber: '示例-C913/008',
    subjects: ['求职', '职业规划'],
    sourceUrl: 'https://book.douban.com/subject/26126225/',
  },
  {
    externalId: 'sample-0016',
    title: '拆掉思维里的墙',
    authors: ['古典'],
    subjects: ['职业规划', '自我成长'],
    summary: '讨论限制个人发展的常见思维定式，以及如何重新看待职业选择。',
    sourceUrl: 'https://book.douban.com/subject/4953695/',
  },
  {
    externalId: 'sample-0017',
    title: '心流',
    authors: ['米哈里·契克森米哈赖'],
    callNumber: '示例-B84/062',
    subjects: ['积极心理学', '专注'],
    summary: '讨论人在全神贯注投入活动时的最优体验，以及进入这种状态的条件。',
    sourceUrl: 'https://book.douban.com/subject/27186106/',
  },
  {
    externalId: 'sample-0018',
    title: '终身成长',
    authors: ['卡罗尔·德韦克'],
    callNumber: '示例-B848/021',
    subjects: ['心理学', '成长型思维'],
    summary: '比较固定型与成长型两种思维模式，分析它们对学习和工作的影响。',
    sourceUrl: 'https://book.douban.com/subject/27154533/',
  },
  {
    externalId: 'sample-0019',
    title: '原则',
    authors: ['瑞·达利欧'],
    callNumber: '示例-F830/045',
    subjects: ['管理', '决策'],
    summary: '作者总结的生活与工作原则，以及如何把原则系统化地用于决策。',
    sourceUrl: 'https://book.douban.com/subject/27608239/',
  },
  {
    externalId: 'sample-0020',
    title: '刻意练习',
    authors: ['安德斯·艾利克森', '罗伯特·普尔'],
    callNumber: '示例-G442/017',
    subjects: ['学习方法', '技能'],
    summary: '介绍有目标、有反馈的练习方式如何系统地提升专业能力。',
    sourceUrl: 'https://book.douban.com/subject/26895993/',
  },
  // 主题 C：从地方文献认识一座城市
  {
    externalId: 'sample-0021',
    title: '看不见的城市',
    authors: ['伊塔洛·卡尔维诺'],
    callNumber: '示例-I546/009',
    subjects: ['外国文学', '城市'],
    summary: '以马可·波罗向忽必烈讲述城市的形式，写出数十座想象中的城市。',
    sourceUrl: 'https://book.douban.com/subject/10555509/',
  },
  {
    externalId: 'sample-0022',
    title: '美国大城市的死与生',
    authors: ['简·雅各布斯'],
    callNumber: '示例-TU984/013',
    subjects: ['城市规划', '社区'],
    summary: '从街道、街区与社区活力出发，批评脱离日常生活的城市规划方式。',
    sourceUrl: 'https://book.douban.com/subject/1870268/',
  },
  {
    externalId: 'sample-0023',
    title: '乡土中国',
    authors: ['费孝通'],
    callNumber: '示例-C912/002',
    subjects: ['社会学', '乡土社会'],
    summary: '以"差序格局"等概念分析中国传统乡土社会的结构与运行逻辑。',
    sourceUrl: 'https://book.douban.com/subject/1795079/',
  },
  // 干扰项：用于检验筛选能否排除与主题关联较弱的书
  {
    externalId: 'sample-0024',
    title: '活着',
    authors: ['余华'],
    callNumber: '示例-I247/101',
    subjects: ['中国当代文学', '小说'],
    summary: '讲述主人公福贵历经时代变迁与亲人离散的一生。',
    sourceUrl: 'https://book.douban.com/subject/4913064/',
  },
  {
    externalId: 'sample-0025',
    title: '万历十五年',
    authors: ['黄仁宇'],
    callNumber: '示例-K248/006',
    subjects: ['明史', '历史'],
    summary: '以万历十五年前后的人物与事件为切口，分析明代政治与社会的结构性问题。',
    sourceUrl: 'https://book.douban.com/subject/1041482/',
  },
  {
    externalId: 'sample-0026',
    title: '三体',
    authors: ['刘慈欣'],
    callNumber: '示例-I247/088',
    subjects: ['科幻小说'],
    summary: '以人类文明与三体文明的接触为主线的长篇科幻小说。',
    sourceUrl: 'https://book.douban.com/subject/2567698/',
  },
  {
    externalId: 'sample-0027',
    title: '人类简史：从动物到上帝',
    authors: ['尤瓦尔·赫拉利'],
    callNumber: '示例-K02/003',
    subjects: ['历史', '人类学'],
    summary: '从认知革命、农业革命到科学革命，概述智人发展的历史。',
    sourceUrl: 'https://book.douban.com/subject/25985021/',
  },
  {
    externalId: 'sample-0028',
    title: '算法霸权',
    authors: ['凯西·奥尼尔'],
    callNumber: '示例-TP18/031',
    subjects: ['算法'],
    sourceUrl: 'https://book.douban.com/subject/30295861/',
  },
];

export const SAMPLE_SOURCE_ID = 'src_sample';
export const SAMPLE_SOURCE_NAME = '示例书库';
/** 示例书库内容变化时提升版本号，启动时自动重新灌入 */
export const SAMPLE_LIBRARY_VERSION = 2;

export function sampleBookDrafts(at: string): (BookDraft & { externalId: string })[] {
  return seeds.map((seed) => {
    const draft: BookDraft & { externalId: string } = { ...seed, isSample: true, provenance: {} };
    for (const field of bookFieldKeys) {
      const value = draft[field];
      const present = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
      if (present) draft.provenance[field] = { origin: 'sample', at, verified: false };
    }
    return draft;
  });
}
