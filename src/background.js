import { providers } from './providers/index.js';
import { isSignedOut } from './lib/http.js';
import { readSettings } from './lib/settings.js';

const ALARM = 'refresh';
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
  const entries = await Promise.all(active.map(async p => [p.id, await load(p, previous[p.id])]));
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

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  schedule();
  refresh();
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'refresh') return;
  refresh().then(
    () => reply({ ok: true }),
    () => reply({ ok: false })
  );
  return true;
});
