import { providers } from '../providers/index.js';

export const INTERVALS = [5, 15, 30, 60];

export const DEFAULTS = {
  enabled: Object.fromEntries(providers.map(p => [p.id, true])),
  badge: true,
  interval: 15
};

export async function readSettings() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  return {
    ...DEFAULTS,
    ...settings,
    enabled: { ...DEFAULTS.enabled, ...settings.enabled }
  };
}

export async function writeSettings(patch) {
  const current = await readSettings();
  const next = {
    ...current,
    ...patch,
    enabled: { ...current.enabled, ...patch.enabled }
  };
  await chrome.storage.sync.set({ settings: next });
  return next;
}
