import { providers } from '../providers/index.js';
import { INTERVALS, readSettings, writeSettings } from '../lib/settings.js';

const STALE_AFTER = 60_000;
const LOADING_TIMEOUT = 60_000;

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const $ = selector => document.querySelector(selector);

let state = {};
let settings = await readSettings();

translate();
bind();
state = await chrome.storage.local.get(['results', 'updatedAt', 'loadingSince']);
render();
renderSettings();
if (!state.updatedAt || Date.now() - state.updatedAt > STALE_AFTER) refresh();
setInterval(render, 30_000);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local') {
    for (const [key, { newValue }] of Object.entries(changes)) state[key] = newValue;
    render();
  }
  if (area === 'sync' && changes.settings) {
    settings = await readSettings();
    render();
    renderSettings();
  }
});

function translate() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
    node.setAttribute('aria-label', node.title);
  }
}

function bind() {
  $('#refresh').addEventListener('click', refresh);
  $('#toggle').addEventListener('click', () => {
    const open = $('#settings').hidden;
    $('#settings').hidden = !open;
    $('#list').hidden = open;
    $('#toggle').setAttribute('aria-pressed', String(open));
  });
  $('#source').addEventListener('click', event => {
    event.preventDefault();
    openTab(event.currentTarget.href);
  });
}

function refresh() {
  state.loadingSince = Date.now();
  render();
  chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
}

function isLoading() {
  return Boolean(state.loadingSince) && Date.now() - state.loadingSince < LOADING_TIMEOUT;
}

function render() {
  const loading = isLoading();
  $('#refresh').classList.toggle('spinning', loading);
  $('#refresh').disabled = loading;
  $('#stamp').textContent = state.updatedAt ? ago(state.updatedAt) : '';

  const active = providers.filter(p => settings.enabled[p.id]);
  const results = state.results ?? {};
  const list = $('#list');

  if (!active.length) {
    list.replaceChildren(el('p', { class: 'empty' }, t('nothingEnabled')));
    return;
  }
  list.replaceChildren(...active.map(p => providerBlock(p, results[p.id], loading)));
}

function providerBlock(provider, result, loading) {
  const head = el('div', { class: 'head' },
    el('span', { class: 'name' }, provider.name),
    result?.plan ? el('span', { class: 'plan' }, result.plan) : null,
    el('button', {
      class: 'open',
      type: 'button',
      title: t('openSite', provider.name),
      'aria-label': t('openSite', provider.name),
      onclick: () => openTab(provider.home)
    }, icon('M6 3.5h6.5V10M12.5 3.5L4 12'))
  );
  return el('section', { class: 'provider', 'data-status': result?.status ?? 'pending' }, head, body(provider, result, loading));
}

function body(provider, result, loading) {
  if (!result) {
    return el('div', { class: 'placeholder' },
      el('span', { class: 'meter ghost' }, el('i')),
      el('span', { class: 'muted' }, loading ? t('loading') : t('waiting'))
    );
  }

  if (result.status === 'signed_out') {
    return el('div', { class: 'message' },
      el('span', {}, t('signedOut')),
      el('button', { class: 'link', type: 'button', onclick: () => openTab(provider.login) }, t('signIn'))
    );
  }

  if (result.status === 'error') {
    return el('div', { class: 'message' },
      el('span', {}, t('loadFailed')),
      el('code', {}, result.error ?? '')
    );
  }

  if (!result.windows.length) return el('p', { class: 'muted' }, t('noLimits'));

  return el('div', { class: 'windows' },
    ...result.windows.map(windowRow),
    result.stale ? el('p', { class: 'stale' }, t('stale')) : null
  );
}

function windowRow(win) {
  const value = Math.max(0, win.percent);
  const level = value >= 90 ? 'hot' : value >= 70 ? 'warn' : 'calm';
  const label = win.span ? t(win.label, duration(win.span)) : t(win.label);

  return el('div', { class: 'window', 'data-level': level },
    el('div', { class: 'row' },
      el('div', { class: 'caption' },
        el('span', { class: 'label' }, label),
        el('span', { class: 'reset' }, resetText(win.resetsAt))
      ),
      el('span', { class: 'value' }, String(Math.round(value)), el('small', {}, '%'))
    ),
    el('div', {
      class: 'meter',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(Math.min(value, 100))),
      'aria-label': label,
      style: `--fill: ${Math.min(value, 100)}%`
    }, el('i'))
  );
}

function renderSettings() {
  $('#service-toggles').replaceChildren(...providers.map(p =>
    toggle(p.name, settings.enabled[p.id], on => writeSettings({ enabled: { [p.id]: on } }))
  ));
  $('#badge-toggle').replaceChildren(
    toggle(t('badgeLabel'), settings.badge, on => writeSettings({ badge: on }))
  );
  $('#intervals').replaceChildren(...INTERVALS.map(minutes =>
    el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(settings.interval === minutes),
      onclick: () => writeSettings({ interval: minutes })
    }, `${minutes}${t('unitMinute')}`)
  ));
}

function toggle(label, on, change) {
  return el('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': String(on),
    onclick: () => change(!on)
  }, el('span', {}, label), el('span', { class: 'knob', 'aria-hidden': 'true' }, el('i')));
}

function resetText(at) {
  if (!at) return '';
  const left = at - Date.now();
  return left <= 0 ? t('resetsNow') : t('resetsIn', duration(left));
}

function ago(at) {
  const diff = Date.now() - at;
  return diff < 60_000 ? t('justNow') : t('updatedAgo', duration(diff));
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

function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  stroke.setAttribute('d', path);
  svg.append(stroke);
  return svg;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
}
