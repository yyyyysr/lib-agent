import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { roleLabels, statusLabels, type Role, type UserInfo } from '@yys/shared';
import { TopBar } from '../../app/TopBar';
import { StatusBadge } from '../../components/workflow';
import { Badge, Button, Dialog, Field, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { useRpc } from '../../lib/use-rpc';
import { useAppStore } from '../../store/app-store';
import { useAuth } from '../../store/auth-store';
import { act } from '../curation/actions';

function UsersTab() {
  const me = useAuth((s) => s.user);
  const { data: users = [] } = useRpc('users.list', undefined, { topics: ['users.changed'] });
  const [resetting, setResetting] = useState<UserInfo | null>(null);
  const [password, setPassword] = useState('');

  return (
    <>
      <table className="w-full text-left text-[13px]">
        <thead className="text-xs text-subtle">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">姓名</th>
            <th className="py-2 pr-3 font-medium">用户名</th>
            <th className="py-2 pr-3 font-medium">学号 / 工号</th>
            <th className="py-2 pr-3 font-medium">部门</th>
            <th className="py-2 pr-3 font-medium">角色</th>
            <th className="py-2 pr-3 font-medium">最近登录</th>
            <th className="py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className={cn('border-b border-border', u.status === 'disabled' && 'opacity-50')}
            >
              <td className="py-2.5 pr-3 font-medium">
                {u.displayName} {u.id === me?.id && <Badge>我</Badge>}
              </td>
              <td className="py-2.5 pr-3 text-muted">{u.username}</td>
              <td className="py-2.5 pr-3 text-muted">{u.memberNo}</td>
              <td className="py-2.5 pr-3 text-muted">{u.department || '—'}</td>
              <td className="py-2.5 pr-3">
                <select
                  aria-label={`${u.displayName} 的角色`}
                  value={u.role}
                  onChange={(e) =>
                    void act(
                      'users.update',
                      { id: u.id, role: e.target.value as Role },
                      '角色已更新',
                    )
                  }
                  className="h-8 rounded-lg border border-border bg-bg px-2 text-[13px]"
                >
                  {(Object.keys(roleLabels) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {roleLabels[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2.5 pr-3 text-muted">{formatDateTime(u.lastLoginAt) || '—'}</td>
              <td className="py-2.5">
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => (setResetting(u), setPassword(''))}
                  >
                    <KeyRound className="size-3.5" /> 重置密码
                  </Button>
                  {u.id !== me?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(
                          'users.update',
                          { id: u.id, status: u.status === 'active' ? 'disabled' : 'active' },
                          u.status === 'active' ? '已停用' : '已启用',
                        )
                      }
                    >
                      {u.status === 'active' ? '停用' : '启用'}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-subtle">
        新注册的账号默认为普通用户。审批管理员负责立项与上线审批；超级管理员管理用户权限与全局数据。至少需要保留一名超级管理员。
      </p>
      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        title={`重置“${resetting?.displayName ?? ''}”的密码`}
        description="重置后该用户在所有设备上的登录都会失效。"
        width="max-w-md"
        footer={
          <Button
            variant="primary"
            disabled={password.length < 8}
            onClick={async () => {
              if (
                resetting &&
                (await act('users.resetPassword', { id: resetting.id, password }, '密码已重置')) !==
                  null
              )
                setResetting(null);
            }}
          >
            确认重置
          </Button>
        }
      >
        <Field label="新密码" hint="至少 8 位">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

function DataTab() {
  const navigate = useAppStore((s) => s.navigate);
  const { data: stats } = useRpc('admin.stats', undefined, {
    topics: ['exhibitions.changed', 'users.changed', 'books.changed'],
  });
  const { data: exhibitions = [] } = useRpc(
    'exhibitions.list',
    { scope: 'all' },
    { topics: ['exhibitions.changed'] },
  );
  const [unpublishing, setUnpublishing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const totalUsers = stats ? Object.values(stats.users).reduce((a, b) => a + b, 0) : 0;
  const totalExhibitions = stats
    ? Object.values(stats.exhibitions).reduce((a, b) => a + (b ?? 0), 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {[
          [
            '用户',
            totalUsers,
            stats ? `审批管理员 ${stats.users.approver} · 超管 ${stats.users.superadmin}` : '',
          ],
          [
            '书展',
            totalExhibitions,
            stats
              ? `已上线 ${(stats.exhibitions.published ?? 0) + (stats.exhibitions.completed ?? 0)}`
              : '',
          ],
          ['待审批', stats?.pendingApprovals ?? 0, ''],
          ['书目', stats?.books ?? 0, stats ? `${stats.sources} 个来源` : ''],
        ].map(([label, value, sub]) => (
          <div key={label as string} className="rounded-2xl border border-border p-4">
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-xs text-muted">{label}</p>
            {sub && <p className="mt-1 text-[11px] text-subtle">{sub}</p>}
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 text-[13px] font-semibold">全部书展</p>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {exhibitions.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => navigate({ name: 'exhibition', id: e.id })}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[13px] font-medium">{e.title}</p>
                <p className="text-xs text-muted">
                  {e.owner.name} · 更新于 {formatDateTime(e.updatedAt)}
                </p>
              </button>
              <StatusBadge status={e.status} />
              {(e.status === 'published' || e.status === 'completed') && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => (setUnpublishing(e.id), setReason(''))}
                >
                  下线
                </Button>
              )}
            </li>
          ))}
          {exhibitions.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-muted">还没有书展</li>
          )}
        </ul>
        <p className="mt-2 text-xs text-subtle">
          状态说明：{Object.values(statusLabels).join(' → ')}
        </p>
      </div>
      <Dialog
        open={unpublishing !== null}
        onOpenChange={(open) => !open && setUnpublishing(null)}
        title="下线这个书展？"
        description="书展会从首页撤下，退回到“上线需修改”，策展人修改后可重新提交上线审批。"
        width="max-w-md"
        footer={
          <Button
            variant="danger"
            disabled={!reason.trim()}
            onClick={async () => {
              if (
                unpublishing &&
                (await act(
                  'exhibitions.unpublish',
                  { id: unpublishing, comment: reason },
                  '已下线',
                )) !== null
              )
                setUnpublishing(null);
            }}
          >
            下线
          </Button>
        }
      >
        <Field label="下线原因">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}

export function AdminView({ tab }: { tab: 'users' | 'data' }) {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="管理" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 pt-2 pb-10">
          <div className="mb-5 flex gap-1">
            {(['users', 'data'] as const).map((t) => (
              <button
                key={t}
                onClick={() => navigate({ name: 'admin', tab: t })}
                className={cn(
                  'h-8 rounded-lg px-3 text-[13px]',
                  tab === t ? 'bg-surface-2 font-medium' : 'text-muted hover:bg-surface-hover',
                )}
              >
                {t === 'users' ? '用户与权限' : '全局数据'}
              </button>
            ))}
          </div>
          {tab === 'users' ? <UsersTab /> : <DataTab />}
        </div>
      </div>
    </div>
  );
}
