import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { approvalKindLabels } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { Badge, EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { useRpc } from '../../lib/use-rpc';
import { useAppStore } from '../../store/app-store';
import { useAuth } from '../../store/auth-store';

export function ApprovalsView() {
  const navigate = useAppStore((s) => s.navigate);
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const { data = [], loading } = useRpc(
    'approvals.list',
    { status: tab },
    { topics: ['approvals.changed', 'exhibitions.changed'] },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="审批" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-8 pt-2 pb-10">
          <div className="mb-4 flex gap-1">
            {(['pending', 'done'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'h-8 rounded-lg px-3 text-[13px]',
                  tab === t ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-hover',
                )}
              >
                {t === 'pending' ? '待审批' : '已处理'}
              </button>
            ))}
          </div>
          {loading && data.length === 0 ? (
            <Spinner className="mx-auto mt-10" />
          ) : data.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-8" />}
              title={tab === 'pending' ? '没有待审批的申请' : '还没有处理过的申请'}
              description="策展人提交立项审批或上线审批后会出现在这里。"
            />
          ) : (
            <ul className="space-y-2">
              {data.map((a) => {
                const own = a.submittedBy.id === me?.id;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() =>
                        navigate({
                          name: 'exhibition',
                          id: a.exhibitionId,
                          step: a.kind === 'proposal' ? 'approval1' : 'approval2',
                        })
                      }
                      className="w-full rounded-2xl border border-border p-4 text-left hover:bg-surface-hover"
                    >
                      <div className="flex items-center gap-2">
                        <Badge tone={a.kind === 'proposal' ? 'accent' : 'warning'}>
                          {approvalKindLabels[a.kind]}
                        </Badge>
                        <span className="flex-1 truncate font-medium">{a.exhibitionTitle}</span>
                        {a.status !== 'pending' && (
                          <Badge tone={a.status === 'approved' ? 'success' : 'danger'}>
                            {a.status === 'approved' ? '同意' : '退回修改'}
                          </Badge>
                        )}
                        {own && a.status === 'pending' && <Badge>本人提交，需由他人审批</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {a.submittedBy.name} 提交于 {formatDateTime(a.submittedAt)}
                        {a.reviewer &&
                          ` · ${a.reviewer.name} 处理于 ${formatDateTime(a.reviewedAt)}`}
                      </p>
                      {a.comment && (
                        <p className="mt-2 text-[13px] text-muted">意见：{a.comment}</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
