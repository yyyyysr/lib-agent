import { bookFieldKeys, type BookDraft, type BookFieldKey } from '@yys/shared';
import catalog from './catalog.json';

/** 书目记录中来自图书馆编目数据的部分（见 catalog.json） */
type CatalogRecord = Partial<
  Pick<
    BookDraft,
    | 'isbn'
    | 'publisher'
    | 'pubYear'
    | 'callNumber'
    | 'summary'
    | 'sourceUrl'
    | 'coverUrl'
    | 'docType'
    | 'responsibility'
    | 'otherTitles'
    | 'pubPlace'
    | 'keywords'
    | 'language'
    | 'clcNumber'
    | 'extent'
    | 'catalogSource'
    | 'catalogUrl'
  >
> & { title: string; nlcRecord?: string };

type SampleSeed = Pick<BookDraft, 'title' | 'authors' | 'subjects' | 'summary'> & {
  externalId: string;
  /** 刻意去掉的字段，用于演示核对清单 */
  omit?: BookFieldKey[];
  /** 重复记录：只带原记录的来源链接与封面 */
  duplicateOf?: string;
};

const records = catalog.books as unknown as Record<string, CatalogRecord>;

/**
 * 示例书库：均为真实出版的中文图书。
 * - 书名、作者、主题词（策展用标签）在下方维护；
 * - ISBN、出版信息、著录字段、内容简介来自中国国家图书馆“文津”书目记录（无国图记录时来自豆瓣读书），
 *   封面为对应版本的实体书封面，来源链接为对应版本的豆瓣读书页面，均保存在 catalog.json；
 * - 索书号取自国图 OPAC 的馆藏记录（中文基藏），可在能访问国图 OPAC 的网络下运行 `pnpm sample:callnumbers` 更新。
 * 刻意保留的缺陷用于演示核对清单：
 * - sample-0012、sample-0016 不带索书号
 * - sample-0013、sample-0015 不带摘要
 * - sample-0028 与 sample-0003 为同一本书的重复记录（另一批导入，字段较少）
 */

const seeds: SampleSeed[] = [
  // 主题 A：新生如何识别 AI 生成的信息
  {
    externalId: 'sample-0001',
    title: '智人之上：从石器时代到AI时代的信息网络简史',
    authors: ['尤瓦尔·赫拉利'],
    subjects: ['信息网络', '人工智能', '历史'],
    summary: '从历史视角讨论信息网络如何塑造人类社会，以及人工智能给信息秩序带来的新挑战。',
  },
  {
    externalId: 'sample-0002',
    title: '智能革命：迎接人工智能时代的社会、经济与文化变革',
    authors: ['李彦宏'],
    subjects: ['人工智能', '社会影响', '科普'],
    summary: '从技术、产业与社会治理等角度，讨论人工智能将如何改变人们的生活与工作。',
  },
  {
    externalId: 'sample-0003',
    title: '大数据时代：生活、工作与思维的大变革',
    authors: ['维克托·迈尔-舍恩伯格', '肯尼斯·库克耶'],
    subjects: ['大数据', '算法', '社会影响'],
    summary: '讨论大数据如何改变人们认识世界与决策的方式，以及数据驱动带来的隐私与公平问题。',
  },
  {
    externalId: 'sample-0004',
    title: '学会提问',
    authors: ['尼尔·布朗', '斯图尔特·基利'],
    subjects: ['批判性思维', '论证'],
    summary: '介绍识别论证结构、评估证据与发现推理谬误的提问方法。',
  },
  {
    externalId: 'sample-0005',
    title: '统计数字会撒谎',
    authors: ['达莱尔·哈夫'],
    subjects: ['统计', '数据素养'],
    summary: '用通俗案例揭示图表与统计数字被误用、误读的常见方式。',
  },
  {
    externalId: 'sample-0006',
    title: '对伪心理学说不',
    authors: ['基思·斯坦诺维奇'],
    subjects: ['批判性思维', '科学素养', '证据评估'],
    summary: '以心理学为例，介绍可证伪性、相关与因果、个案证据等概念，帮助读者识别似是而非的说法。',
  },
  {
    externalId: 'sample-0007',
    title: '思考，快与慢',
    authors: ['丹尼尔·卡尼曼'],
    subjects: ['心理学', '决策', '认知偏差'],
    summary: '介绍直觉与理性两种思维系统，以及它们如何导致系统性的判断偏差。',
  },
  {
    externalId: 'sample-0008',
    title: '娱乐至死',
    authors: ['尼尔·波兹曼'],
    subjects: ['媒介批评', '传播学'],
    summary: '讨论电视等媒介形式如何改变公共话语的方式与质量。',
  },
  {
    externalId: 'sample-0009',
    title: '浅薄：互联网如何毒化了我们的大脑',
    authors: ['尼古拉斯·卡尔'],
    subjects: ['互联网', '注意力', '阅读'],
    summary: '讨论互联网的阅读与信息获取方式如何影响人的专注力与深度思考。',
  },
  {
    externalId: 'sample-0010',
    title: '生命3.0',
    authors: ['迈克斯·泰格马克'],
    subjects: ['人工智能', '未来学'],
    summary: '探讨通用人工智能可能带来的社会影响，以及人类应如何为此做准备。',
  },
  {
    externalId: 'sample-0011',
    title: '简单的逻辑学',
    authors: ['D.Q.麦克伦尼'],
    subjects: ['逻辑', '批判性思维', '论证'],
    summary: '用通俗的例子介绍逻辑推理的基本原则与常见谬误，帮助读者清晰地思考与表达。',
  },
  {
    externalId: 'sample-0012',
    omit: ['callNumber'],
    title: '乌合之众：大众心理研究',
    authors: ['古斯塔夫·勒庞'],
    subjects: ['社会心理学', '群体'],
    summary: '分析群体心理的特征，以及群体环境对个人判断的影响。',
  },
  {
    externalId: 'sample-0013',
    omit: ['summary'],
    title: '噪声',
    authors: ['丹尼尔·卡尼曼', '奥利维耶·西博尼', '卡斯·桑斯坦'],
    subjects: ['决策', '判断'],
  },
  // 主题 B：求职季的职业探索阅读
  {
    externalId: 'sample-0014',
    title: '远见：如何规划职业生涯3大阶段',
    authors: ['布赖恩·费瑟斯通豪'],
    subjects: ['职业规划', '生涯发展'],
    summary: '把职业生涯分为三个阶段，介绍每个阶段积累可迁移技能、经验与人脉的方法。',
  },
  {
    externalId: 'sample-0015',
    omit: ['summary'],
    title: '你的降落伞是什么颜色？',
    authors: ['理查德·尼尔森·鲍利斯'],
    subjects: ['求职', '职业规划'],
  },
  {
    externalId: 'sample-0016',
    omit: ['callNumber'],
    title: '拆掉思维里的墙',
    authors: ['古典'],
    subjects: ['职业规划', '自我成长'],
    summary: '讨论限制个人发展的常见思维定式，以及如何重新看待职业选择。',
  },
  {
    externalId: 'sample-0017',
    title: '心流',
    authors: ['米哈里·契克森米哈赖'],
    subjects: ['积极心理学', '专注'],
    summary: '讨论人在全神贯注投入活动时的最优体验，以及进入这种状态的条件。',
  },
  {
    externalId: 'sample-0018',
    title: '终身成长',
    authors: ['卡罗尔·德韦克'],
    subjects: ['心理学', '成长型思维'],
    summary: '比较固定型与成长型两种思维模式，分析它们对学习和工作的影响。',
  },
  {
    externalId: 'sample-0019',
    title: '原则',
    authors: ['瑞·达利欧'],
    subjects: ['管理', '决策'],
    summary: '作者总结的生活与工作原则，以及如何把原则系统化地用于决策。',
  },
  {
    externalId: 'sample-0020',
    title: '刻意练习',
    authors: ['安德斯·艾利克森', '罗伯特·普尔'],
    subjects: ['学习方法', '技能'],
    summary: '介绍有目标、有反馈的练习方式如何系统地提升专业能力。',
  },
  // 主题 C：从地方文献认识一座城市
  {
    externalId: 'sample-0021',
    title: '看不见的城市',
    authors: ['伊塔洛·卡尔维诺'],
    subjects: ['外国文学', '城市'],
    summary: '以马可·波罗向忽必烈讲述城市的形式，写出数十座想象中的城市。',
  },
  {
    externalId: 'sample-0022',
    title: '美国大城市的死与生',
    authors: ['简·雅各布斯'],
    subjects: ['城市规划', '社区'],
    summary: '从街道、街区与社区活力出发，批评脱离日常生活的城市规划方式。',
  },
  {
    externalId: 'sample-0023',
    title: '乡土中国',
    authors: ['费孝通'],
    subjects: ['社会学', '乡土社会'],
    summary: '以"差序格局"等概念分析中国传统乡土社会的结构与运行逻辑。',
  },
  // 干扰项：用于检验筛选能否排除与主题关联较弱的书
  {
    externalId: 'sample-0024',
    title: '活着',
    authors: ['余华'],
    subjects: ['中国当代文学', '小说'],
    summary: '讲述主人公福贵历经时代变迁与亲人离散的一生。',
  },
  {
    externalId: 'sample-0025',
    title: '万历十五年',
    authors: ['黄仁宇'],
    subjects: ['明史', '历史'],
    summary: '以万历十五年前后的人物与事件为切口，分析明代政治与社会的结构性问题。',
  },
  {
    externalId: 'sample-0026',
    title: '三体',
    authors: ['刘慈欣'],
    subjects: ['科幻小说'],
    summary: '以人类文明与三体文明的接触为主线的长篇科幻小说。',
  },
  {
    externalId: 'sample-0027',
    title: '人类简史：从动物到上帝',
    authors: ['尤瓦尔·赫拉利'],
    subjects: ['历史', '人类学'],
    summary: '从认知革命、农业革命到科学革命，概述智人发展的历史。',
  },
  {
    externalId: 'sample-0028',
    duplicateOf: 'sample-0003',
    title: '大数据时代',
    authors: ['维克托·迈尔-舍恩伯格'],
    subjects: ['大数据'],
  },
];

export const SAMPLE_SOURCE_ID = 'src_sample';
export const SAMPLE_SOURCE_NAME = '示例书库';
/** 示例书库内容变化时提升（catalog.json 中的 version），启动时自动重新灌入 */
export const SAMPLE_LIBRARY_VERSION: number = catalog.version;

function draftOf(seed: SampleSeed): BookDraft & { externalId: string } {
  const { externalId, omit = [], duplicateOf, ...curated } = seed;
  const {
    title: _editionTitle,
    nlcRecord: _nlcRecord,
    ...record
  } = records[duplicateOf ?? externalId] ?? { title: seed.title };
  const base: Omit<CatalogRecord, 'title' | 'nlcRecord'> = duplicateOf
    ? { sourceUrl: record.sourceUrl, coverUrl: record.coverUrl }
    : record;
  const draft: BookDraft & { externalId: string } = {
    ...base,
    ...curated,
    summary: base.summary ?? curated.summary,
    externalId,
    isSample: true,
    provenance: {},
  };
  for (const field of omit) delete draft[field];
  return draft;
}

export function sampleBookDrafts(at: string): (BookDraft & { externalId: string })[] {
  return seeds.map((seed) => {
    const draft = draftOf(seed);
    for (const field of bookFieldKeys) {
      const value = draft[field];
      const present = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
      if (present) draft.provenance[field] = { origin: 'sample', at, verified: false };
    }
    return draft;
  });
}
