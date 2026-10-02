import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptedModel } from '@yys/agent-core/testing';
import { openRepositories, type Repositories } from '@yys/db';
import type {
  AgentProgress,
  AppErrorShape,
  AuthResult,
  ExhibitionDetail,
  ShowcaseExhibition,
  WireMessage,
} from '@yys/shared';
import { AuthService } from './auth';
import { RpcServer, type PortLike } from './rpc-server';
import { seedDefaultSchool, seedSampleLibrary } from './seed';
import { createServices } from './services/index';

/** 内存中的端口：模拟 Renderer ↔ Core 的 MessagePort */
function createClient(server: RpcServer) {
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const inbox: WireMessage[] = [];
  const waiters: (() => void)[] = [];
  const port: PortLike = {
    on: (event: 'message' | 'close', listener: never) => {
      if (event === 'message') listeners.push(listener);
      return port;
    },
    postMessage: (message) => {
      inbox.push(structuredClone(message) as WireMessage);
      waiters.splice(0).forEach((wake) => wake());
    },
    start: () => {},
  };
  server.attach(port);
  let seq = 0;
  const send = (message: WireMessage): void =>
    listeners.forEach((l) => l({ data: structuredClone(message) }));
  const waitFor = async <T extends WireMessage>(match: (m: WireMessage) => m is T): Promise<T> => {
    for (;;) {
      const found = inbox.find(match);
      if (found) return found;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  async function raw(
    method: string,
    params: unknown,
    token?: string,
  ): Promise<{ result?: unknown; error?: AppErrorShape }> {
    const id = ++seq;
    send({ kind: 'req', id, method, params, token });
    return waitFor(
      (m): m is Extract<WireMessage, { kind: 'res' }> => m.kind === 'res' && m.id === id,
    );
  }
  return {
    inbox,
    raw,
    /** 期望成功，否则抛出带错误信息的异常，便于定位 */
    async call<T = unknown>(method: string, params: unknown, token?: string): Promise<T> {
      const res = await raw(method, params, token);
      if (res.error) throw new Error(`${method} 失败：${res.error.code} ${res.error.message}`);
      return res.result as T;
    },
    async stream(
      method: string,
      params: unknown,
      token?: string,
    ): Promise<{ chunks: AgentProgress[]; error?: AppErrorShape }> {
      const id = ++seq;
      send({ kind: 'stream', id, method, params, token });
      const end = await waitFor(
        (m): m is Extract<WireMessage, { kind: 'end' }> => m.kind === 'end' && m.id === id,
      );
      const chunks = inbox
        .filter(
          (m): m is Extract<WireMessage, { kind: 'chunk' }> => m.kind === 'chunk' && m.id === id,
        )
        .map((m) => m.chunk as AgentProgress);
      return { chunks, error: end.error };
    },
  };
}

const profile = (name: string, no: string) => ({
  displayName: name,
  memberNo: no,
  department: '图书馆',
});
const brief = {
  theme: '新生如何识别 AI 生成的信息',
  audience: '大一新生',
  eventDate: '2026-11-15',
  eventTime: '14:00–15:00',
  venue: '一楼大厅',
  bookCount: 8,
};

describe('Core：登录、权限与书展工作流（经 RPC）', () => {
  let dir: string;
  let repos: Repositories;
  let client: ReturnType<typeof createClient>;
  let admin: AuthResult;
  let curator: AuthResult;
  let approver: AuthResult;
  let vault: Map<string, string>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yys-core-'));
    repos = openRepositories(join(dir, 'core.db'));
    seedSampleLibrary(repos);
    seedDefaultSchool(repos);
    const { model } = createScriptedModel();
    vault = new Map<string, string>();
    const secrets = {
      get: async (ref: string) => vault.get(ref) ?? null,
      remove: (ref: string) => void vault.delete(ref),
    };
    const auth = new AuthService(repos, {
      builtinAdmin: { username: 'super_user', password: '12345678' },
      secrets,
    });
    await auth.ensureBuiltinAdmin();
    let server: RpcServer;
    const { handlers, streams } = createServices({
      repos,
      auth,
      secrets,
      createModel: () => model,
      emit: (topic, payload) => server.emit(topic, payload),
      info: {
        version: 'test',
        dataDir: dir,
        platform: 'test',
        nodeVersion: process.versions.node,
        coreStartedAt: '',
      },
    });
    server = new RpcServer(
      handlers,
      streams,
      (token) => auth.authenticate(token),
      () => {},
    );
    client = createClient(server);

    expect(await client.call('auth.status', undefined)).toEqual({
      builtinAdmin: { username: 'super_user', defaultPassword: '12345678' },
    });
    admin = await client.call<AuthResult>('auth.login', {
      username: 'super_user',
      password: '12345678',
    });
    curator = await client.call<AuthResult>('auth.register', {
      ...profile('李同学', '2024010203'),
      username: 'curator',
      password: 'curator-pass',
    });
    const reviewer = await client.call<AuthResult>('auth.register', {
      ...profile('王老师', 'T9001'),
      username: 'reviewer',
      password: 'reviewer-pass',
    });
    await client.call('users.update', { id: reviewer.user.id, role: 'approver' }, admin.token);
    approver = await client.call<AuthResult>('auth.login', {
      username: 'reviewer',
      password: 'reviewer-pass',
    });

    // 超级管理员配置一个共享的本地模型，普通用户无需自带 Key
    await client.call(
      'providers.save',
      {
        presetId: 'ollama',
        displayName: '共享模型',
        models: [{ id: 'qwen3' }],
        enabled: true,
        shared: true,
      },
      admin.token,
    );
  });
  afterEach(() => {
    repos.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('内置超级管理员已初始化；所有注册账号都是普通用户', () => {
    expect(admin.user).toMatchObject({
      role: 'superadmin',
      builtin: true,
      mustChangePassword: true,
    });
    expect(curator.user.role).toBe('user');
    expect(approver.user.role).toBe('approver');
  });

  it('内置超级管理员不能降级或停用；修改初始密码后登录框不再提示初始密码', async () => {
    expect(
      (await client.raw('users.update', { id: admin.user.id, role: 'user' }, admin.token)).error
        ?.message,
    ).toContain('内置超级管理员');
    expect(
      (await client.raw('users.update', { id: admin.user.id, status: 'disabled' }, admin.token))
        .error?.code,
    ).toBe('invalid_state');
    const updated = await client.call<{ mustChangePassword: boolean }>(
      'auth.changePassword',
      { oldPassword: '12345678', newPassword: 'new-admin-pass' },
      admin.token,
    );
    expect(updated.mustChangePassword).toBe(false);
    expect(await client.call('auth.status', undefined)).toEqual({
      builtinAdmin: { username: 'super_user' },
    });
  });

  it('记住密码：用保存的密码一键登录；密码被重置后失效记录被清除', async () => {
    expect((await client.raw('auth.loginRemembered', { username: 'curator' })).error?.code).toBe(
      'not_found',
    );
    vault.set('account:curator', 'curator-pass');
    const result = await client.call<AuthResult>('auth.loginRemembered', { username: 'Curator' });
    expect(result.user.username).toBe('curator');

    await client.call(
      'users.resetPassword',
      { id: result.user.id, password: 'reset-pass-1' },
      admin.token,
    );
    const stale = await client.raw('auth.loginRemembered', { username: 'curator' });
    expect(stale.error).toMatchObject({ code: 'unauthorized', message: '保存的密码已失效' });
    expect(vault.has('account:curator')).toBe(false);
    // 被重置密码的用户下次登录需自行修改
    const relogin = await client.call<AuthResult>('auth.login', {
      username: 'curator',
      password: 'reset-pass-1',
    });
    expect(relogin.user.mustChangePassword).toBe(true);
  });

  it('权限：未登录、普通用户、审批管理员各自被拒绝的操作', async () => {
    expect((await client.raw('exhibitions.list', {})).error?.code).toBe('unauthorized');
    expect((await client.raw('users.list', undefined, curator.token)).error?.code).toBe(
      'forbidden',
    );
    expect((await client.raw('approvals.list', {}, curator.token)).error?.code).toBe('forbidden');
    expect((await client.raw('users.list', undefined, approver.token)).error?.code).toBe(
      'forbidden',
    );
    expect(
      (await client.raw('exhibitions.list', { scope: 'all' }, curator.token)).error?.code,
    ).toBe('forbidden');
    expect(
      (
        await client.raw(
          'providers.save',
          { presetId: 'ollama', models: [], enabled: true, shared: true },
          curator.token,
        )
      ).error?.code,
    ).toBe('forbidden');
    // 首页对所有人公开
    expect((await client.raw('showcase.latest', undefined)).error).toBeUndefined();
  });

  it('登录：错误密码、停用账号、退出后令牌失效', async () => {
    expect(
      (await client.raw('auth.login', { username: 'curator', password: 'wrong' })).error?.code,
    ).toBe('unauthorized');
    await client.call('auth.logout', undefined, curator.token);
    expect(await client.call('auth.me', undefined, curator.token)).toBeNull();

    const again = await client.call<AuthResult>('auth.login', {
      username: 'CURATOR',
      password: 'curator-pass',
    });
    await client.call('users.update', { id: again.user.id, status: 'disabled' }, admin.token);
    expect(await client.call('auth.me', undefined, again.token)).toBeNull();
    expect(
      (await client.raw('auth.login', { username: 'curator', password: 'curator-pass' })).error
        ?.message,
    ).toContain('停用');
  });

  it('学校默认为中山大学：首页公开可读，修改后不再被默认值覆盖，申请书写入主办单位', async () => {
    expect(await client.call('school.branding', undefined)).toEqual({
      schoolName: '中山大学',
      organizer: '中山大学图书馆',
    });
    await client.call(
      'settings.setSchool',
      { id: 'school_default', name: '示例大学图书馆' },
      admin.token,
    );
    expect(seedDefaultSchool(repos)).toBe(false);
    expect(await client.call('school.branding', undefined)).toEqual({
      schoolName: '示例大学图书馆',
      organizer: '示例大学图书馆',
    });
    expect(
      (await client.raw('settings.setSchool', { id: 'x', name: 'x' }, curator.token)).error?.code,
    ).toBe('forbidden');

    const { id } = await client.call<ExhibitionDetail>('exhibitions.create', brief, curator.token);
    await client.stream('agent.run', { id, task: 'curate' }, curator.token);
    await client.stream('agent.run', { id, task: 'proposal' }, curator.token);
    const detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, curator.token);
    expect(detail.proposal?.organizer).toBe('示例大学图书馆');
  });

  it('非内置的超级管理员可以正常授予与撤销', async () => {
    const second = await client.call<AuthResult>('auth.register', {
      ...profile('副管', 'A002'),
      username: 'admin2',
      password: 'admin2-pass',
    });
    expect(second.user.role).toBe('user');
    await client.call('users.update', { id: second.user.id, role: 'superadmin' }, admin.token);
    const demoted = await client.raw(
      'users.update',
      { id: second.user.id, role: 'user' },
      admin.token,
    );
    expect(demoted.error).toBeUndefined();
  });

  it('完整流程：需求 → 策展 → 申请书 → 立项审批（退回再通过）→ 活动包 → 上线审批 → 首页 → 反馈 → 复盘', async () => {
    const t = curator.token;
    let detail = await client.call<ExhibitionDetail>('exhibitions.create', brief, t);
    const id = detail.id;
    expect(detail.status).toBe('draft');

    // 策展：进度事件依次到达
    const run = await client.stream('agent.run', { id, task: 'curate' }, t);
    expect(run.error).toBeUndefined();
    expect(
      run.chunks
        .filter((c) => c.type === 'stage' && c.status === 'done')
        .map((c) => (c as { stage: string }).stage),
    ).toEqual(['pool', 'select', 'structure', 'write', 'check']);
    expect(run.chunks.at(-1)).toEqual({ type: 'done', status: 'reviewing' });
    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.plan?.books).toHaveLength(8);
    expect(detail.checks.some((c) => c.category === 'sample')).toBe(true);

    // 申请书：申请人信息来自账号资料
    await client.stream('agent.run', { id, task: 'proposal' }, t);
    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.status).toBe('proposal_draft');
    expect(detail.proposal?.applicant).toMatchObject({ name: '李同学', memberNo: '2024010203' });

    // 立项审批：普通用户不能审批；退回必须写意见
    detail = await client.call<ExhibitionDetail>('exhibitions.submit', { id, kind: 'proposal' }, t);
    expect(detail.status).toBe('proposal_pending');
    const [pending] = await client.call<{ id: string }[]>(
      'approvals.list',
      { status: 'pending' },
      approver.token,
    );
    expect(
      (await client.raw('approvals.decide', { approvalId: pending!.id, decision: 'approve' }, t))
        .error?.code,
    ).toBe('forbidden');
    expect(
      (
        await client.raw(
          'approvals.decide',
          { approvalId: pending!.id, decision: 'changes' },
          approver.token,
        )
      ).error?.code,
    ).toBe('invalid_params');
    await client.call(
      'approvals.decide',
      { approvalId: pending!.id, decision: 'changes', comment: '请补充活动报名方式' },
      approver.token,
    );
    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.status).toBe('proposal_changes');
    expect(detail.approvals[0]).toMatchObject({
      status: 'changes_requested',
      comment: '请补充活动报名方式',
      reviewer: { name: '王老师' },
    });

    // 修改后重新提交，审批同意
    await client.call(
      'exhibitions.updateProposal',
      { id, proposal: { ...detail.proposal!, support: '一楼大厅展架两组；报名通过图书馆公众号' } },
      t,
    );
    await client.call('exhibitions.submit', { id, kind: 'proposal' }, t);
    const [again] = await client.call<{ id: string }[]>(
      'approvals.list',
      { status: 'pending' },
      approver.token,
    );
    await client.call(
      'approvals.decide',
      { approvalId: again!.id, decision: 'approve', comment: '同意' },
      approver.token,
    );
    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.status).toBe('proposal_approved');

    // 立项通过后方案锁定
    expect(
      (await client.raw('exhibitions.updatePlan', { id, plan: detail.plan }, t)).error?.code,
    ).toBe('invalid_state');

    // 活动包与上线审批；上线前首页为空
    await client.stream('agent.run', { id, task: 'package' }, t);
    await client.call('exhibitions.submit', { id, kind: 'package' }, t);
    expect(await client.call('showcase.latest', undefined)).toBeNull();
    const [pkgApproval] = await client.call<{ id: string }[]>(
      'approvals.list',
      { status: 'pending' },
      approver.token,
    );
    await client.call(
      'approvals.decide',
      { approvalId: pkgApproval!.id, decision: 'approve' },
      approver.token,
    );

    let showcase = await client.call<ShowcaseExhibition>('showcase.latest', undefined);
    expect(showcase).toMatchObject({
      id,
      status: 'published',
      title: '真假之间',
      brief: { venue: '一楼大厅' },
      owner: { name: '李同学' },
    });
    expect(showcase.sections.flatMap((s) => s.books)).toHaveLength(8);
    expect(showcase.package.poster.headline).toBe('真假之间');

    // 活动后：录入执行记录与匿名反馈
    await client.call(
      'exhibitions.updateExecution',
      { id, execution: { heldOn: '2026-11-15', participants: 36, notes: '现场讨论热烈' } },
      t,
    );
    detail = await client.call<ExhibitionDetail>(
      'feedback.add',
      {
        id,
        entries: [
          { rating: 5, content: '案例讨论很有收获，联系我 13812345678' },
          { rating: 4, content: '希望多一些实操练习环节' },
        ],
      },
      t,
    );
    expect(detail.feedback[0]!.content).toContain('［手机号已隐去］');

    await client.stream('agent.run', { id, task: 'retrospective' }, t);
    showcase = await client.call<ShowcaseExhibition>('showcase.latest', undefined);
    expect(showcase.status).toBe('completed');
    expect(showcase.feedbackStats).toMatchObject({
      count: 2,
      averageRating: 4.5,
      highlights: ['希望多一些实操练习环节'],
    });
    expect(showcase.retrospective?.nextTime.length).toBeGreaterThan(0);
    expect(showcase.execution.participants).toBe(36);

    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(['created', 'agent', 'submit', 'review', 'publish', 'feedback']),
    );
  });

  it('必须处理的核对项会阻止生成申请书；忽略时必须写明理由', async () => {
    const t = curator.token;
    const report = await client.call<{ sourceId: string }>(
      'books.importText',
      {
        text: '书名,作者,索书号\n乡土中国,费孝通,C912/2\n心流,米哈里·契克森米哈赖,B84/62\n原则,瑞·达利欧,F830/45',
        format: 'csv',
        sourceName: '资料室',
      },
      t,
    );
    const { id } = await client.call<ExhibitionDetail>(
      'exhibitions.create',
      { ...brief, bookCount: 3, sourceIds: [report.sourceId] },
      t,
    );
    await client.stream('agent.run', { id, task: 'curate' }, t);
    let detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    const blockers = detail.checks.filter((c) => c.severity === 'blocker');
    expect(blockers).toHaveLength(3);

    const blocked = await client.stream('agent.run', { id, task: 'proposal' }, t);
    expect(blocked.error).toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('3 项'),
    });

    expect(
      (await client.raw('checks.update', { id, itemId: blockers[0]!.id, status: 'dismissed' }, t))
        .error?.code,
    ).toBe('invalid_params');
    for (const item of blockers) {
      await client.call(
        'checks.update',
        { id, itemId: item.id, status: 'dismissed', note: '馆员确认在架，链接稍后补充' },
        t,
      );
    }
    expect((await client.stream('agent.run', { id, task: 'proposal' }, t)).error).toBeUndefined();
    detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, t);
    expect(detail.status).toBe('proposal_draft');
  });

  it('审批人不能审批自己提交的申请；他人不能修改别人的书展', async () => {
    const t = approver.token;
    const { id } = await client.call<ExhibitionDetail>('exhibitions.create', brief, t);
    await client.stream('agent.run', { id, task: 'curate' }, t);
    await client.stream('agent.run', { id, task: 'proposal' }, t);
    await client.call('exhibitions.submit', { id, kind: 'proposal' }, t);
    const [own] = await client.call<{ id: string }[]>('approvals.list', { status: 'pending' }, t);
    expect(
      (await client.raw('approvals.decide', { approvalId: own!.id, decision: 'approve' }, t)).error
        ?.message,
    ).toContain('不能审批自己');
    expect((await client.raw('exhibitions.get', { id }, curator.token)).error?.code).toBe(
      'forbidden',
    );
    expect(
      (await client.raw('exhibitions.updateBrief', { id, brief }, admin.token)).error?.code,
    ).toBe('forbidden');
  });

  it('没有任何可用模型时给出可操作的提示', async () => {
    const [shared] = await client.call<{ id: string }[]>('providers.list', undefined, admin.token);
    await client.call('providers.delete', { id: shared!.id }, admin.token);
    const { id } = await client.call<ExhibitionDetail>('exhibitions.create', brief, curator.token);
    const run = await client.stream('agent.run', { id, task: 'curate' }, curator.token);
    expect(run.error).toMatchObject({ code: 'no_model', hint: expect.stringContaining('设置') });
    const detail = await client.call<ExhibitionDetail>('exhibitions.get', { id }, curator.token);
    expect(detail).toMatchObject({ status: 'draft', running: false });
  });
});
