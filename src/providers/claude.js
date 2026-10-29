import { getJson, SignedOutError } from '../lib/http.js';

const BASE = 'https://claude.ai';
const HOUR = 3_600_000;

const WINDOWS = [
  { key: 'five_hour', label: 'session', span: 5 * HOUR },
  { key: 'seven_day', label: 'weekly' },
  { key: 'seven_day_opus', label: 'weeklyOpus', optional: true },
  { key: 'seven_day_sonnet', label: 'weeklySonnet', optional: true }
];

export default {
  id: 'claude',
  name: 'Claude',
  home: `${BASE}/new`,
  login: `${BASE}/login`,

  async load() {
    const orgs = await getJson(`${BASE}/api/organizations`);
    const candidates = (Array.isArray(orgs) ? orgs : [])
      .filter(org => org?.uuid)
      .sort((a, b) => canChat(b) - canChat(a));
    if (!candidates.length) throw new SignedOutError();

    let failure = null;
    for (const org of candidates) {
      try {
        const usage = await getJson(`${BASE}/api/organizations/${org.uuid}/usage`);
        const windows = WINDOWS.map(spec => toWindow(usage?.[spec.key], spec)).filter(Boolean);
        if (windows.length) return { plan: planOf(org), windows };
      } catch (error) {
        failure = error;
      }
    }
    if (failure) throw failure;
    return { plan: planOf(candidates[0]), windows: [] };
  }
};

function canChat(org) {
  return Array.isArray(org.capabilities) && org.capabilities.includes('chat') ? 1 : 0;
}

function planOf(org) {
  const tier = String(org.rate_limit_tier ?? '');
  const multiplier = tier.match(/max_(\d+x)/i);
  if (multiplier) return `Max ${multiplier[1].toLowerCase()}`;
  const caps = Array.isArray(org.capabilities) ? org.capabilities : [];
  if (caps.includes('claude_max')) return 'Max';
  if (caps.includes('claude_pro')) return 'Pro';
  return null;
}

function toWindow(entry, spec) {
  if (!entry || typeof entry.utilization !== 'number') return null;
  if (spec.optional && !entry.resets_at && entry.utilization === 0) return null;
  const resetsAt = entry.resets_at ? Date.parse(entry.resets_at) : null;
  return {
    label: spec.label,
    span: spec.span ?? null,
    percent: entry.utilization,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null
  };
}
