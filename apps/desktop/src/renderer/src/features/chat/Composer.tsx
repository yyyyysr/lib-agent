import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, Check, ChevronDown, FileUp, LibraryBig, Plus, Settings2, Square, TriangleAlert } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store/app-store';
import { useImportBooks } from '../library/useImportBooks';
import { sameRef, useModels } from './useModels';

function ModelPicker() {
  const { options, primary, setPrimary } = useModels();
  const navigate = useAppStore((s) => s.navigate);
  const groups = options.reduce<Record<string, typeof options>>((acc, option) => {
    (acc[option.providerName] ??= []).push(option);
    return acc;
  }, {});

  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-8 max-w-56 items-center gap-1 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-hover hover:text-fg">
          {primary ? (
            <span className="truncate">{primary.label}</span>
          ) : (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5" /> 未选择模型
            </span>
          )}
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" side="top">
        {Object.entries(groups).map(([provider, models]) => (
          <div key={provider}>
            <MenuLabel>{provider}</MenuLabel>
            {models.map((model) => (
              <MenuItem key={`${model.providerId}:${model.modelId}`} onSelect={() => void setPrimary(model)}>
                <span className="flex-1 truncate">{model.label}</span>
                {!model.hasKey && <span className="text-[11px] text-warning">缺 Key</span>}
                {model.capabilities?.toolCalling === 'no' && <span className="text-[11px] text-subtle">不支持工具</span>}
                {sameRef(model, primary) && <Check className="size-3.5 text-accent" />}
              </MenuItem>
            ))}
          </div>
        ))}
        {options.length > 0 && <MenuSeparator />}
        <MenuItem onSelect={() => navigate({ name: 'settings', section: 'models' })}>
          <Settings2 className="size-3.5" /> 管理模型与密钥…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  placeholder = '描述你想策划的书展，或提出修改…',
  autoFocus,
  size = 'md',
  below,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  size?: 'md' | 'lg';
  below?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const navigate = useAppStore((s) => s.navigate);
  const { importFromFile, dialogs } = useImportBooks();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="w-full">
      <div
        className={cn(
          'rounded-[26px] border border-border bg-bg shadow-[0_2px_12px_rgb(0_0_0/0.06)] transition-colors focus-within:border-border-strong dark:bg-surface',
          size === 'lg' ? 'px-4 pt-4 pb-2.5' : 'px-3.5 pt-3 pb-2',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法组词时按回车只确认候选词，不发送
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          className={cn(
            'block max-h-60 w-full resize-none bg-transparent px-1.5 text-fg placeholder:text-subtle focus:outline-none',
            size === 'lg' ? 'min-h-12 text-base' : 'min-h-7 text-[15px]',
          )}
        />
        <div className="mt-1.5 flex items-center gap-1">
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="添加书目" size="sm" className="rounded-full">
                <Plus className="size-[18px]" />
              </IconButton>
            </MenuTrigger>
            <MenuContent side="top">
              <MenuItem onSelect={() => void importFromFile()}>
                <FileUp className="size-3.5" /> 从文件导入书目（Excel / CSV / TXT / JSON）
              </MenuItem>
              <MenuItem onSelect={() => navigate({ name: 'library' })}>
                <LibraryBig className="size-3.5" /> 打开书库
              </MenuItem>
            </MenuContent>
          </Menu>
          <div className="flex-1" />
          <ModelPicker />
          {busy ? (
            <button
              aria-label="停止生成"
              onClick={onStop}
              className="flex size-8 items-center justify-center rounded-full bg-fg text-bg hover:opacity-85"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              aria-label="发送"
              disabled={!canSend}
              onClick={onSubmit}
              className="flex size-8 items-center justify-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85 disabled:opacity-25"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      {below}
      {dialogs}
    </div>
  );
}
