import { providers } from '../providers/index.js';

export const INTERVALS = [5, 15, 30, 60];

export const OVERLAY_ORIGINS = ['<all_urls>'];

export const DEFAULTS = {
  enabled: Object.fromEntries(providers.map(p => [p.id, true])),
  badge: true,
  interval: 15,
  overlay: {
    enabled: false,
    hidden: [],
    style: 'solid',
    layout: 'row',
    scale: 1,
    opacity: 1
  }
};

export async function readSettings() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  return {
    ...DEFAULTS,
    ...settings,
    enabled: { ...DEFAULTS.enabled, ...settings.enabled },
    overlay: { ...DEFAULTS.overlay, ...settings.overlay }
  };
}

export async function writeSettings(patch) {
  const current = await readSettings();
  const next = {
    ...current,
    ...patch,
    enabled: { ...current.enabled, ...patch.enabled },
    overlay: { ...current.overlay, ...patch.overlay }
  };
  await chrome.storage.sync.set({ settings: next });
  return next;
}
