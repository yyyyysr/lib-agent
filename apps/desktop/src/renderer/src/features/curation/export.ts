import { checkCategoryLabels, type ExhibitionDetail, type Proposal } from '@yys/shared';
import { formatDate } from '../../lib/format';

const when = (date: string, time: string): string =>
  [formatDate(date), time].filter(Boolean).join(' ') || '待定';

export function proposalMarkdown(proposal: Proposal, organizer: string): string {
  return [
    `# 主题书展策展申请书：${proposal.title}`,
    '',
    `主办单位：${organizer}`,
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 主题 | ${proposal.theme} |`,
    `| 目标读者 | ${proposal.audience} |`,
    `| 拟开展形式 | ${proposal.format.replace(/\n/g, ' ')} |`,
    `| 活动时间 | ${when(proposal.schedule.date, proposal.schedule.time)} |`,
    `| 活动地点 | ${proposal.schedule.venue || '待定'} |`,
    `| 申请人 | ${proposal.applicant.name}（学号/工号 ${proposal.applicant.memberNo}）${proposal.applicant.department ? ` · ${proposal.applicant.department}` : ''} |`,
    '',
    '## 活动目的与意义',
    proposal.purpose,
    '',
    '## 书单',
    '| 序号 | 书名 | 作者 | 索书号 | 展区 |',
    '| --- | --- | --- | --- | --- |',
    ...proposal.booklist.map(
      (b, i) => `| ${i + 1} | 《${b.title}》 | ${b.authors} | ${b.callNumber} | ${b.section} |`,
    ),
    '',
    '## 预期成果',
    proposal.expectedOutcomes,
    '',
    '## 所需支持',
    proposal.support,
    '',
  ].join('\n');
}

/** 完整活动包：策展说明、书单与导读、展示文案、活动流程、推广材料、核对清单、反馈问卷 */
export function packageMarkdown(detail: ExhibitionDetail, organizer: string): string {
  const { plan, package: pkg, brief, checks } = detail;
  if (!plan || !pkg) return '';
  const lines: string[] = [
    `# ${plan.title}${plan.subtitle ? `——${plan.subtitle}` : ''}`,
    '',
    `- 主办：${organizer}`,
    `- 主题：${brief.theme}`,
    `- 面向：${brief.audience}`,
    `- 时间：${when(brief.eventDate, brief.eventTime)}`,
    `- 地点：${brief.venue || '待定'}`,
    '',
    '## 一、策展说明',
    `**活动目标**：${plan.statement.goals}`,
    '',
    `**读者特点**：${plan.statement.audienceNote}`,
    '',
    `**展区结构**：${plan.statement.structureLogic}`,
    '',
    `**选书逻辑**：${plan.statement.selectionLogic}`,
    '',
    '## 二、总导语',
    plan.introduction,
    '',
    '## 三、展区与书单',
  ];
  plan.sections.forEach((section, i) => {
    lines.push('', `### 第 ${i + 1} 展区：${section.title}`, '', `> ${section.panelText}`, '');
    for (const entry of plan.books.filter((b) => b.sectionId === section.id)) {
      const b = entry.book;
      lines.push(
        `**《${b.title}》** ${b.authors.join('、')}${b.callNumber ? ` ｜ 索书号 ${b.callNumber}` : ' ｜ 索书号待核对'}${b.sourceUrl ? ` ｜ [馆藏链接](${b.sourceUrl})` : ''}`,
        '',
        `- 关联理由：${entry.reason}`,
        `- 导读：${entry.guide}`,
        '',
      );
    }
  });
  lines.push(
    `## 四、线下活动：${plan.activity.format}（约 ${plan.activity.durationMinutes} 分钟）`,
    '',
    ...plan.activity.segments.map((s) => `- **${s.minutes} 分钟 · ${s.title}**：${s.description}`),
    '',
    '讨论问题：',
    ...plan.activity.questions.map((q) => `- ${q}`),
    '',
    '## 五、推广材料',
    '',
    `### 海报文字`,
    `- 主标题：${pkg.poster.headline}`,
    `- 副标题：${pkg.poster.subheadline}`,
    `- 宣传语：${pkg.poster.tagline}`,
    `- 亮点：${pkg.poster.highlights.join('；')}`,
    `- 行动号召：${pkg.poster.callToAction}`,
    '',
    `### 推文：${pkg.promotion.postTitle}`,
    pkg.promotion.postBody,
    '',
    '### 报名介绍',
    pkg.promotion.signupIntro,
    '',
    '### 校园通知',
    pkg.promotion.notice,
    '',
    '## 六、核对清单',
    ...(checks.length
      ? checks.map(
          (c) =>
            `- [${c.status === 'open' ? ' ' : 'x'}] 【${checkCategoryLabels[c.category]}】${c.message}${c.note ? `（处理说明：${c.note}）` : ''}`,
        )
      : ['- 无']),
    '',
    '## 七、活动反馈问卷（匿名）',
    ...pkg.feedbackQuestions.map((q, i) => `${i + 1}. ${q}`),
    '',
    '---',
    '本活动包由“一页书展”智能体生成草案，书目信息与文案已经策展人核对、审批人审核。',
    '',
  );
  return lines.join('\n');
}
