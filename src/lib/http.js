export class SignedOutError extends Error {
  constructor() {
    super('signed_out');
  }
}

export class RequestError extends Error {
  constructor(status, json) {
    super(status ? `HTTP ${status}` : 'Network error');
    this.status = status;
    this.json = json;
  }
}

export const isSignedOut = error =>
  error instanceof SignedOutError ||
  (error instanceof RequestError && (error.status === 401 || (error.status === 403 && error.json)));

export async function getJson(url, init = {}) {
  let response = await safely(() => direct(url, init));
  if (!response || response.data === undefined) {
    const fromTab = await safely(() => viaOpenTab(url, init));
    if (fromTab) response = fromTab;
  }
  if (!response) throw new RequestError(0, false);
  const hasJson = response.data !== undefined;
  if (response.status >= 200 && response.status < 300 && hasJson) return response.data;
  throw new RequestError(response.status, hasJson);
}

async function safely(task) {
  try {
    return await task();
  } catch {
    return null;
  }
}

async function direct(url, init) {
  const res = await fetch(url, { ...init, credentials: 'include' });
  return decode(res.status, await res.text());
}

async function viaOpenTab(url, init) {
  const { origin } = new URL(url);
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const tab = tabs.find(t => !t.discarded);
  if (!tab) return null;
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (target, options) => {
      const res = await fetch(target, { ...options, credentials: 'include' });
      return { status: res.status, text: await res.text() };
    },
    args: [url, init]
  });
  const result = injection?.result;
  return result ? decode(result.status, result.text) : null;
}

function decode(status, text) {
  try {
    return { status, data: JSON.parse(text) };
  } catch {
    return { status, data: undefined };
  }
}

export function titleCase(value) {
  if (typeof value !== 'string' || !value) return null;
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
