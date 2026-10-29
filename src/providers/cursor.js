import { getJson, titleCase } from '../lib/http.js';

const BASE = 'https://cursor.com';

export default {
  id: 'cursor',
  name: 'Cursor',
  home: `${BASE}/dashboard`,
  login: `${BASE}/dashboard`,

  async load() {
    const summary = await getJson(`${BASE}/api/usage-summary`);
    const usage = summary?.individualUsage ?? {};
    const end = Date.parse(summary?.billingCycleEnd);
    const resetsAt = Number.isFinite(end) ? end : null;

    const windows = [];
    const included = percentOf(usage.plan);
    if (included !== null) windows.push({ label: 'monthly', span: null, percent: included, resetsAt });

    const onDemand = usage.onDemand;
    const extra = onDemand?.enabled ? percentOf(onDemand) : null;
    if (extra !== null) windows.push({ label: 'onDemand', span: null, percent: extra, resetsAt });

    return { plan: titleCase(summary?.membershipType), windows };
  }
};

function percentOf(bucket) {
  if (!bucket) return null;
  if (typeof bucket.totalPercentUsed === 'number') return bucket.totalPercentUsed;
  if (typeof bucket.used === 'number' && typeof bucket.limit === 'number' && bucket.limit > 0) {
    return (bucket.used / bucket.limit) * 100;
  }
  return null;
}
