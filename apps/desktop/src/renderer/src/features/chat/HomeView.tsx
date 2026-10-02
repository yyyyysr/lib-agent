import { useState } from 'react';
import { BrainCircuit, Briefcase, KeyRound, Landmark } from 'lucide-react';
import { newId } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { Button } from '../../components/ui';
import { useAppStore } from '../../store/app-store';
import { Composer } from './Composer';
import { useModels } from './useModels';

const examples = [
  {
    icon: BrainCircuit,
    title: '新生如何识别 AI 生成的信息',
    prompt: '我想在 11 月中旬为大一新生办一场“如何识别 AI 生成的信息”主题微书展，地点在图书馆一楼大厅，选 10 本左右的书。请先帮我梳理主题结构，再从馆藏中找候选书目。',
  },
  {
    icon: Briefcase,
    title: '求职季的职业探索阅读',
    prompt: '求职季快到了，想面向大三、大四学生做一场“职业探索阅读”书展，大约 8 本书，配一场 30 分钟的分享会。请帮我梳理思路并检索候选书目。',
  },
  {
    icon: Landmark,
    title: '从地方文献认识一座城市',
    prompt: '想做一场“从地方文献认识一座城市”的书展，面向全校师生，书目 8–12 本。主题有点宽，请先给我几个可以收窄的方向。',
  },
];

const quickFields = ['目标读者：', '活动时间：', '场地：', '书目数量：10 本', '特殊要求：'];

export function HomeView() {
  const navigate = useAppStore((s) => s.navigate);
  const { options, primary, loading } = useModels();
  const [text, setText] = useState('');

  const start = (prompt: string): void => {
    const value = prompt.trim();
    if (!value) return;
    navigate({ name: 'chat', id: newId('conv'), pendingText: value });
  };

  const needsSetup = !loading && (!primary || !primary.hasKey);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-[10vh]">
        <div className="w-full max-w-[720px]">
          <h1 className="mb-8 text-center text-[28px] font-semibold tracking-tight">今天想策划什么主题的书展？</h1>

          {needsSetup && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
              <KeyRound className="size-4 shrink-0 text-accent" />
              <p className="flex-1 text-[13px] text-muted">
                {options.length === 0
                  ? '先添加一个模型服务商并填写你自己的 API Key（BYOK），Key 只加密保存在本机。'
                  : primary
                    ? `主模型“${primary.label}”所属服务商还没有填写 API Key。`
                    : '还没有选择主模型。'}
              </p>
              <Button size="sm" variant="primary" onClick={() => navigate({ name: 'settings', section: 'models' })}>
                去设置
              </Button>
            </div>
          )}

          <Composer
            size="lg"
            value={text}
            onChange={setText}
            onSubmit={() => start(text)}
            autoFocus
            placeholder="描述主题、目标读者、活动时间与场地…"
            below={
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {quickFields.map((field) => (
                  <button
                    key={field}
                    onClick={() => setText((t) => (t ? `${t.trimEnd()}\n${field}` : field))}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-hover hover:text-fg"
                  >
                    {field.replace(/：.*$/, '')}
                  </button>
                ))}
              </div>
            }
          />

          <div className="mt-10 grid grid-cols-3 gap-3">
            {examples.map(({ icon: Icon, title, prompt }) => (
              <button
                key={title}
                onClick={() => start(prompt)}
                className="rounded-2xl border border-border p-4 text-left transition-colors hover:bg-surface-hover"
              >
                <Icon className="size-4 text-accent" />
                <p className="mt-2.5 text-[13px] leading-snug font-medium">{title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{prompt}</p>
              </button>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-subtle">示例主题会使用内置的示例书库，导入学校馆藏后即可围绕真实书目策展。</p>
        </div>
      </div>
    </div>
  );
}
