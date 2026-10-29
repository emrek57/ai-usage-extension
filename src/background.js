import { providers } from './providers/index.js';
import { isSignedOut } from './lib/http.js';
import { OVERLAY_ORIGINS, readSettings, writeSettings } from './lib/settings.js';

const ALARM = 'refresh';
const OVERLAY = {
  id: 'overlay',
  matches: OVERLAY_ORIGINS,
  js: ['src/overlay/overlay.js'],
  runAt: 'document_idle'
};
let inflight = null;

function refresh() {
  inflight ??= run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run() {
  const settings = await readSettings();
  const { results: previous = {} } = await chrome.storage.local.get('results');
  await chrome.storage.local.set({ loadingSince: Date.now() });

  const active = providers.filter(p => settings.enabled[p.id]);
  const entries = await Promise.all(active.map(async p => [p.id, { ...(await load(p, previous[p.id])), name: p.name }]));
  const results = Object.fromEntries(entries);

  await chrome.storage.local.set({ results, updatedAt: Date.now(), loadingSince: null });
  await paintBadge(results, settings);
  return results;
}

async function load(provider, previous) {
  const fetchedAt = Date.now();
  try {
    const { plan = null, windows = [] } = await provider.load();
    return { status: 'ok', plan, windows, fetchedAt };
  } catch (error) {
    if (isSignedOut(error)) return { status: 'signed_out', fetchedAt };
    if (previous?.status === 'ok' && previous.windows?.length) {
      return { ...previous, stale: true, error: error.message };
    }
    return { status: 'error', error: error.message, fetchedAt };
  }
}

async function paintBadge(results, settings) {
  const values = Object.values(results)
    .filter(r => r.status === 'ok')
    .flatMap(r => r.windows.map(w => w.percent));

  if (!settings.badge || !values.length) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const peak = Math.round(Math.max(...values));
  const color = peak >= 90 ? '#c2410c' : peak >= 70 ? '#a16207' : '#262624';
  await chrome.action.setBadgeText({ text: String(peak) });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

async function schedule() {
  const { interval } = await readSettings();
  await chrome.alarms.create(ALARM, { delayInMinutes: 0.1, periodInMinutes: interval });
}

let overlayQueue = Promise.resolve();

function syncOverlay() {
  overlayQueue = overlayQueue.then(applyOverlay).catch(() => {});
  return overlayQueue;
}

async function applyOverlay() {
  const settings = await readSettings();
  const granted = await chrome.permissions.contains({ origins: OVERLAY_ORIGINS });
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY.id] });
  const wanted = settings.overlay.enabled && granted;

  if (wanted && !registered.length) {
    await chrome.scripting.registerContentScripts([OVERLAY]);
    await injectOpenTabs();
  }
  if (!wanted && registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY.id] });
  }
}

async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: OVERLAY.js }).catch(() => {})
  ));
}

function boot() {
  schedule();
  syncOverlay();
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);

chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  if (origins.some(origin => OVERLAY_ORIGINS.includes(origin))) writeSettings({ overlay: { enabled: true } });
});

chrome.permissions.onRemoved.addListener(({ origins = [] }) => {
  if (origins.some(origin => OVERLAY_ORIGINS.includes(origin))) writeSettings({ overlay: { enabled: false } });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const { oldValue = {}, newValue = {} } = changes.settings;
  syncOverlay();
  if (JSON.stringify(oldValue.enabled) !== JSON.stringify(newValue.enabled) || oldValue.interval !== newValue.interval) {
    schedule();
    refresh();
  } else if (oldValue.badge !== newValue.badge) {
    chrome.storage.local.get('results').then(({ results = {} }) => readSettings().then(s => paintBadge(results, s)));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'refresh') return;
  refresh().then(
    () => reply({ ok: true }),
    () => reply({ ok: false })
  );
  return true;
});
