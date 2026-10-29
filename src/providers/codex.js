import { getJson, SignedOutError, titleCase } from '../lib/http.js';

const BASE = 'https://chatgpt.com';
const DAY = 86_400;
const WEEK = 7 * DAY;

export default {
  id: 'codex',
  name: 'Codex',
  home: `${BASE}/codex`,
  login: `${BASE}/auth/login`,

  async load() {
    const session = await getJson(`${BASE}/api/auth/session`);
    const token = session?.accessToken;
    if (!token) throw new SignedOutError();

    const headers = { Authorization: `Bearer ${token}` };
    if (session.account?.id) headers['ChatGPT-Account-Id'] = session.account.id;

    const usage = await getJson(`${BASE}/backend-api/wham/usage`, { headers });
    const limits = usage?.rate_limit ?? {};
    const windows = [limits.primary_window, limits.secondary_window].map(toWindow).filter(Boolean);
    return { plan: titleCase(usage?.plan_type ?? session.account?.planType), windows };
  }
};

function toWindow(entry) {
  if (!entry || typeof entry.used_percent !== 'number') return null;
  const seconds = Number(entry.limit_window_seconds) || 0;
  const label = seconds === WEEK ? 'weekly' : seconds && seconds <= DAY ? 'session' : 'window';
  return {
    label,
    span: seconds && label !== 'weekly' ? seconds * 1000 : null,
    percent: entry.used_percent,
    resetsAt: resetOf(entry)
  };
}

function resetOf(entry) {
  if (Number.isFinite(entry.reset_at)) return entry.reset_at * 1000;
  if (Number.isFinite(entry.reset_after_seconds)) return Date.now() + entry.reset_after_seconds * 1000;
  return null;
}
