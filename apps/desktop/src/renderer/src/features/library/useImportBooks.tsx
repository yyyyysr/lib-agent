import { useState, type ReactNode } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { bookFieldLabels, type BookFieldKey, type ImportReport } from '@yys/shared';
import { Badge, Button, Dialog, Field, Input, Textarea } from '../../components/ui';
import { core, errorText } from '../../lib/core-client';
import { toast } from '../../store/app-store';

type PasteFormat = 'csv' | 'tsv' | 'txt' | 'json';

export function detectPasteFormat(text: string): PasteFormat {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) return 'json';
  const first = trimmed.split(/\r?\n/)[0] ?? '';
  if (first.includes('\t')) return 'tsv';
  if (/[,，]/.test(first) && /书名|题名|title/i.test(first)) return 'csv';
  return 'txt';
}

function ImportReportView({ report }: { report: ImportReport }) {
  const mapped = Object.entries(report.mapping) as [BookFieldKey, string][];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-success">
        <CheckCircle2 className="size-4" /> 已导入 {report.imported} 本到“{report.sourceName}”
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['数据行', report.totalRows],
          ['跳过', report.skipped],
          ['重复', report.duplicates],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border py-2.5">
            <p className="text-lg font-semibold">{value}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">字段识别</p>
        <div className="flex flex-wrap gap-1.5">
          {mapped.map(([field, header]) => (
            <Badge key={field} tone="accent">
              {bookFieldLabels[field]} ← {header === '__cellLink' ? '单元格超链接' : header}
            </Badge>
          ))}
          {report.unmappedHeaders.map((header) => (
            <Badge key={header}>未使用：{header}</Badge>
          ))}
        </div>
      </div>
      {report.issues.length > 0 && (
        <div>
          <p className="mb-1.5 text-[13px] font-medium">需要注意（{report.issues.length}）</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-3 text-xs text-muted">
            {report.issues.map((issue, i) => (
              <li key={i} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" /> 第 {issue.row}{' '}
                行：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 文件导入与粘贴导入的共用入口，返回需要挂载在页面上的对话框 */
export function useImportBooks(): {
  importFromFile: () => Promise<void>;
  openPaste: () => void;
  dialogs: ReactNode;
  busy: boolean;
} {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteName, setPasteName] = useState('手动录入');
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown): void => {
    const { message, hint } = errorText(error);
    toast({ tone: 'error', title: message, description: hint });
  };

  const importFromFile = async (): Promise<void> => {
    const path = await window.yys.dialog.openBookFile();
    if (!path) return;
    setBusy(true);
    try {
      setReport(await core.call('books.importFile', { path }));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const submitPaste = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await core.call('books.importText', {
        text: pasteText,
        format: detectPasteFormat(pasteText),
        sourceName: pasteName || '手动录入',
      });
      setPasteOpen(false);
      setPasteText('');
      setReport(result);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const dialogs = (
    <>
      <Dialog
        open={report !== null}
        onOpenChange={(open) => !open && setReport(null)}
        title="导入完成"
        footer={
          <Button variant="primary" onClick={() => setReport(null)}>
            完成
          </Button>
        }
      >
        {report && <ImportReportView report={report} />}
      </Dialog>
      <Dialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="粘贴书目"
        description="适合学校系统没有导出功能时，复制少量检索结果。每行一本书，或粘贴带表头的表格 / JSON。"
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!pasteText.trim()}
              onClick={() => void submitPaste()}
            >
              导入
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="来源名称">
            <Input value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
          </Field>
          <Field
            label="书目内容"
            hint={
              pasteText.trim()
                ? `识别为：${detectPasteFormat(pasteText).toUpperCase()}`
                : '例：《乡土中国》费孝通　或　书名 / 作者 / 出版社'
            }
          >
            <Textarea
              rows={10}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              className="font-mono text-[13px]"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );

  return { importFromFile, openPaste: () => setPasteOpen(true), dialogs, busy };
}
