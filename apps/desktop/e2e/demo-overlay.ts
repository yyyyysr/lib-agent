/**
 * 演示视频用的页面叠加层：模拟鼠标指针与点击波纹、重点框选、字幕与章节卡。
 * 在页面中执行（page.evaluate），不依赖应用代码；重复注入时直接返回。
 */
export function installDemoOverlay(): void {
  const w = window as unknown as { __demo?: unknown };
  if (w.__demo) return;

  const css = `
  #__demo { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
    font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif; }
  #__demo .cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px;
    transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
    transition: transform 16ms linear; }
  #__demo .ripple { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    border-radius: 50%; border: 3px solid rgba(220, 38, 38, .9); background: rgba(220,38,38,.18);
    animation: __demo-ripple 520ms ease-out forwards; }
  @keyframes __demo-ripple { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
  #__demo .ring { position: absolute; border-radius: 14px; border: 3px solid #dc2626;
    box-shadow: 0 0 0 6px rgba(220,38,38,.16), 0 10px 30px rgba(220,38,38,.18);
    opacity: 0; transition: all 420ms cubic-bezier(.2,.8,.2,1); }
  #__demo .ring.on { opacity: 1; }
  #__demo .tag { position: absolute; left: -3px; top: -34px; white-space: nowrap;
    background: #dc2626; color: #fff; font-size: 14px; font-weight: 600; padding: 4px 10px;
    border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
  #__demo .tag:empty { display: none; }
  #__demo .caption { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
    max-width: 960px; width: max-content; text-align: center; color: #fff; font-size: 18px;
    line-height: 1.5; padding: 7px 18px; border-radius: 10px; background: rgba(17,17,17,.74);
    letter-spacing: .02em; opacity: 0; transition: opacity 260ms; }
  #__demo .caption.on { opacity: 1; }
  #__demo .chapter { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px; color: #fff; opacity: 0;
    background: radial-gradient(circle at 30% 20%, #8f1d1d 0%, #5b0f0f 55%, #2b0606 100%);
    transition: opacity 600ms; }
  #__demo .chapter.on { opacity: 1; }
  #__demo .chapter .kicker { font-size: 18px; letter-spacing: .3em; opacity: .75; }
  #__demo .chapter .title { font-size: 54px; font-weight: 700; letter-spacing: .06em; }
  #__demo .chapter .sub { font-size: 22px; opacity: .9; }
  #__demo .chapter .lines { margin-top: 18px; display: grid; gap: 10px; font-size: 19px; opacity: .92; text-align: center; }
  #__demo .badge { position: absolute; right: 22px; top: 14px; background: rgba(17,17,17,.78);
    color: #fff; font-size: 14px; padding: 5px 12px; border-radius: 999px; opacity: 0;
    transition: opacity 260ms; }
  #__demo .badge.on { opacity: 1; }
  `;
  // 封闭的 Shadow DOM：字幕里的文字不会被 Playwright 的文本定位匹配到
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.id = '__demo';
  root.innerHTML = `
    <div class="ring"><div class="tag"></div></div>
    <div class="chapter"><div class="kicker"></div><div class="title"></div><div class="sub"></div><div class="lines"></div></div>
    <div class="badge"></div>
    <div class="caption"></div>
    <svg class="cursor" viewBox="0 0 30 30"><path d="M6 3 L6 24 L11.2 19.2 L14.8 27 L18.6 25.4 L15 17.8 L22 17.8 Z"
      fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  shadow.appendChild(root);
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const cursor = $<SVGElement>('.cursor');
  const ring = $<HTMLDivElement>('.ring');
  const tag = $<HTMLDivElement>('.tag');
  const caption = $<HTMLDivElement>('.caption');
  const chapter = $<HTMLDivElement>('.chapter');
  const badge = $<HTMLDivElement>('.badge');

  window.addEventListener(
    'mousemove',
    (e) => {
      cursor.style.transform = `translate(${e.clientX - 6}px, ${e.clientY - 3}px)`;
    },
    true,
  );
  window.addEventListener(
    'mousedown',
    (e) => {
      const r = document.createElement('div');
      r.className = 'ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      root.appendChild(r);
      setTimeout(() => r.remove(), 600);
    },
    true,
  );

  w.__demo = {
    focus(rect: { x: number; y: number; width: number; height: number }, label = '') {
      const pad = 8;
      ring.style.left = `${rect.x - pad}px`;
      ring.style.top = `${rect.y - pad}px`;
      ring.style.width = `${rect.width + pad * 2}px`;
      ring.style.height = `${rect.height + pad * 2}px`;
      tag.textContent = label;
      tag.style.top = rect.y - pad < 44 ? `${rect.height + pad * 2 + 6}px` : '-34px';
      ring.classList.add('on');
    },
    clear() {
      ring.classList.remove('on');
    },
    caption(text: string) {
      caption.textContent = text;
      caption.classList.toggle('on', Boolean(text));
    },
    badge(text: string) {
      badge.textContent = text;
      badge.classList.toggle('on', Boolean(text));
    },
    chapter(kicker: string, title: string, sub = '', lines: string[] = []) {
      ($<HTMLDivElement>('.kicker')).textContent = kicker;
      ($<HTMLDivElement>('.title')).textContent = title;
      ($<HTMLDivElement>('.sub')).textContent = sub;
      ($<HTMLDivElement>('.lines')).innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
      chapter.classList.add('on');
    },
    hideChapter() {
      chapter.classList.remove('on');
    },
  };
}
