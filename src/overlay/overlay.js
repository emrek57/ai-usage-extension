(() => {
  if (window.__aiUsageOverlay) return;
  window.__aiUsageOverlay = true;

  const MARGIN = 12;
  const UNHOSTABLE = new Set(['VIDEO', 'AUDIO', 'IMG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED']);
  const DEFAULTS = { enabled: false, hidden: [], style: 'solid', layout: 'row', scale: 1, opacity: 1 };
  const SHORT = {
    weekly: 'shortWeekly',
    weeklyOpus: 'shortOpus',
    weeklySonnet: 'shortSonnet',
    monthly: 'shortMonthly',
    onDemand: 'shortOnDemand'
  };

  const CSS = `
    :host { all: initial; }
    .frame {
      position: fixed;
      top: ${MARGIN}px;
      left: ${MARGIN}px;
      z-index: 2147483647;
      touch-action: none;
    }
    .bar {
      --ink: #ecebe5;
      --soft: #94928a;
      --track: rgba(255, 255, 255, 0.14);
      display: flex;
      gap: 16px;
      padding: 8px 12px 9px;
      border-radius: 8px;
      background: #151514;
      color: var(--ink);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.28);
      font: 11px/1.25 "Cascadia Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      zoom: var(--scale, 1);
      opacity: var(--opacity, 1);
    }
    .bar.column { flex-direction: column; gap: 10px; }
    .bar.dragging { cursor: grabbing; }
    .bar.transparent {
      --soft: #e4e2da;
      --track: rgba(255, 255, 255, 0.32);
      background: transparent;
      box-shadow: none;
      text-shadow: 0 0 2px rgba(0, 0, 0, 0.95), 0 0 6px rgba(0, 0, 0, 0.55);
    }
    .item { --tone: var(--ink); display: grid; gap: 4px; min-width: 96px; }
    .item[data-level="warn"] { --tone: #e2a63b; }
    .item[data-level="hot"] { --tone: #f26b3a; }
    .line { display: flex; align-items: baseline; gap: 6px; }
    .name { font-weight: 600; }
    .label { color: var(--soft); }
    .pct { margin-left: auto; padding-left: 8px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--tone); }
    .meter {
      position: relative;
      height: 4px;
      background: var(--track);
      -webkit-mask: repeating-linear-gradient(90deg, #000 0 calc(10% - 1px), transparent calc(10% - 1px) 10%);
      mask: repeating-linear-gradient(90deg, #000 0 calc(10% - 1px), transparent calc(10% - 1px) 10%);
    }
    .meter i { position: absolute; inset: 0 auto 0 0; background: var(--tone); }
    .reset { font-size: 10px; color: var(--soft); }
    .reset:empty { display: none; }
  `;

  const t = (key, subs) => {
    try {
      return chrome.i18n.getMessage(key, subs) || key;
    } catch {
      return key;
    }
  };

  const host = document.createElement('ai-usage-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('div');
  const bar = document.createElement('div');
  frame.className = 'frame';
  bar.className = 'bar';
  frame.append(bar);
  applyStyles();
  root.append(frame);

  let settings = {};
  let results = {};
  let position = null;
  let drag = null;
  const timer = setInterval(render, 30_000);

  load();
  chrome.storage.onChanged.addListener(onChange);
  addEventListener('resize', place);
  document.addEventListener('fullscreenchange', () => {
    mount();
    place();
  });
  frame.addEventListener('pointerdown', startDrag);
  frame.addEventListener('pointermove', moveDrag);
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);

  function applyStyles() {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
    }
  }

  async function load() {
    try {
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get('settings'),
        chrome.storage.local.get(['results', 'overlayPosition'])
      ]);
      settings = sync.settings ?? {};
      results = local.results ?? {};
      position = local.overlayPosition ?? null;
      render();
    } catch {
      teardown();
    }
  }

  function onChange(changes, area) {
    if (area === 'sync' && changes.settings) settings = changes.settings.newValue ?? {};
    if (area === 'local' && changes.results) results = changes.results.newValue ?? {};
    if (area === 'local' && changes.overlayPosition) position = changes.overlayPosition.newValue ?? null;
    render();
  }

  function alive() {
    if (chrome.runtime?.id) return true;
    teardown();
    return false;
  }

  function teardown() {
    clearInterval(timer);
    host.remove();
  }

  function options() {
    return { ...DEFAULTS, ...settings.overlay };
  }

  function visibleItems() {
    const o = options();
    if (!o.enabled) return [];
    return Object.entries(results)
      .filter(([id, r]) => r?.status === 'ok' && settings.enabled?.[id] !== false)
      .flatMap(([id, r]) => (r.windows ?? []).map(win => ({ id, name: r.name ?? id, win })))
      .filter(({ id, win }) => !o.hidden.includes(`${id}.${win.label}`));
  }

  function render() {
    if (!alive() || drag) return;
    const items = visibleItems();
    if (!items.length) {
      host.remove();
      return;
    }

    const o = options();
    bar.className = ['bar', o.layout === 'column' && 'column', o.style === 'transparent' && 'transparent']
      .filter(Boolean)
      .join(' ');
    bar.style.setProperty('--scale', String(o.scale));
    bar.style.setProperty('--opacity', String(o.opacity));
    bar.replaceChildren(...items.map(item));
    mount();
    place();
  }

  function item({ name, win }) {
    const value = Math.max(0, win.percent);
    const node = el('div', 'item');
    node.dataset.level = value >= 90 ? 'hot' : value >= 70 ? 'warn' : 'calm';

    const line = el('div', 'line');
    line.append(el('span', 'name', name), el('span', 'label', shortLabel(win)), el('span', 'pct', `${Math.round(value)}%`));

    const meter = el('div', 'meter');
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(value, 100)}%`;
    meter.append(fill);

    node.append(line, meter, el('div', 'reset', win.resetsAt ? countdown(win.resetsAt - Date.now()) : ''));
    return node;
  }

  function shortLabel(win) {
    if (win.span) return duration(win.span);
    return t(SHORT[win.label] ?? win.label);
  }

  function countdown(ms) {
    return ms > 0 ? duration(ms) : t('resetsNow');
  }

  function duration(ms) {
    const total = Math.max(1, Math.round(ms / 60_000));
    const days = Math.floor(total / 1440);
    const hours = Math.floor((total % 1440) / 60);
    const minutes = total % 60;
    const d = t('unitDay');
    const h = t('unitHour');
    const m = t('unitMinute');
    if (days) return hours ? `${days}${d} ${hours}${h}` : `${days}${d}`;
    if (hours) return minutes ? `${hours}${h} ${minutes}${m}` : `${hours}${h}`;
    return `${minutes}${m}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount() {
    if (!visibleItems().length) return;
    const full = document.fullscreenElement;
    const parent = full && !UNHOSTABLE.has(full.tagName) ? full : document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
  }

  function bounds() {
    const rect = frame.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      roomX: Math.max(0, innerWidth - rect.width - MARGIN * 2),
      roomY: Math.max(0, innerHeight - rect.height - MARGIN * 2)
    };
  }

  function place() {
    if (!host.isConnected || drag) return;
    const { roomX, roomY } = bounds();
    const x = position?.x ?? 1;
    const y = position?.y ?? 0;
    frame.style.left = `${MARGIN + x * roomX}px`;
    frame.style.top = `${MARGIN + y * roomY}px`;
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    const rect = frame.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    frame.setPointerCapture(event.pointerId);
    bar.classList.add('dragging');
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!drag) return;
    const { width, height } = bounds();
    const left = clamp(event.clientX - drag.dx, 0, innerWidth - width);
    const top = clamp(event.clientY - drag.dy, 0, innerHeight - height);
    frame.style.left = `${left}px`;
    frame.style.top = `${top}px`;
  }

  function endDrag(event) {
    if (!drag) return;
    drag = null;
    bar.classList.remove('dragging');
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    const { roomX, roomY } = bounds();
    const rect = frame.getBoundingClientRect();
    position = {
      x: roomX ? clamp((rect.left - MARGIN) / roomX, 0, 1) : 0,
      y: roomY ? clamp((rect.top - MARGIN) / roomY, 0, 1) : 0
    };
    place();
    if (alive()) chrome.storage.local.set({ overlayPosition: position }).catch(() => {});
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }
})();
