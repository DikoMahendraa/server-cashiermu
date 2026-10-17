/**
 * Shared plumbing for the end-to-end tests. They talk to a running LOCAL API (`npm run dev`) using
 * throwaway accounts defined in .env.example, so they never touch real store data.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect } from 'vitest';

function readExample(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(join(__dirname, '../../.env.example'), 'utf8')
      .split('\n')
      .filter(line => line.startsWith('E2E_'))
      .map(line => line.split('=', 2) as [string, string]),
  );
}

const example = readExample();
const pick = (key: string): string => process.env[key] ?? example[key] ?? '';

export const e2eEnv = {
  url: pick('E2E_API_URL'),
  email: pick('E2E_EMAIL'),
  phone: pick('E2E_PHONE'),
  email2: pick('E2E_EMAIL_2'),
  phone2: pick('E2E_PHONE_2'),
  email3: pick('E2E_EMAIL_3'),
  phone3: pick('E2E_PHONE_3'),
  pin: pick('E2E_PIN'),
};

const host = new URL(e2eEnv.url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`E2E tests must run against a local API, got ${e2eEnv.url}`);
}

export async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${e2eEnv.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

// Access tokens live 15 minutes. Caching them avoids logging in on every run, because the login rate limiter
// (10 per minute per IP) would otherwise block back-to-back e2e runs.
const TOKEN_CACHE = join(tmpdir(), 'cashiermu-e2e-tokens.json');

function readTokenCache(): Record<string, string> {
  try {
    return existsSync(TOKEN_CACHE) ? (JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Returns an access token for a throwaway owner, registering the account on first use.
 * `sector`/`subtype` only matter at registration; an existing store keeps the sector it has.
 */
export async function ensureOwner(account: {
  email: string;
  phone: string;
  storeName: string;
  sector?: string;
  subtype?: string;
}): Promise<string> {
  const cache = readTokenCache();
  const cached = cache[account.email];
  if (cached) {
    const me = await call(cached, 'GET', '/auth/me');
    if (me.status === 200 && me.data.store.name === account.storeName) return cached;
  }

  let login = await call('', 'POST', '/auth/login', { credential: account.email, pin: e2eEnv.pin });
  if (login.status === 401) {
    const reg = await call('', 'POST', '/auth/register', {
      storeName: account.storeName,
      ownerName: 'E2E Owner',
      email: account.email,
      phone: account.phone,
      pin: e2eEnv.pin,
      pinConfirm: e2eEnv.pin,
      ...(account.sector ? { sector: account.sector } : {}),
      ...(account.subtype ? { subtype: account.subtype } : {}),
    });
    expect(reg.status, JSON.stringify(reg.data)).toBe(201);
    login = await call('', 'POST', '/auth/login', { credential: account.email, pin: e2eEnv.pin });
  }
  expect(login.status, JSON.stringify(login.data)).toBe(200);
  expect(login.data.store.name).toBe(account.storeName); // guard: never run against a real store

  const token = login.data.accessToken as string;
  try {
    writeFileSync(TOKEN_CACHE, JSON.stringify({ ...cache, [account.email]: token }));
  } catch {
    // caching is only an optimisation
  }
  return token;
}

/** Opens a shift for the current user if none is open. Returns its id and whether this call opened it. */
export async function ensureShift(token: string): Promise<{ id: string; openedHere: boolean }> {
  const current = await call(token, 'GET', '/shifts/current');
  if (current.data) return { id: current.data.id as string, openedHere: false };
  const branches = await call(token, 'GET', '/branches');
  const opened = await call(token, 'POST', '/shifts/open', {
    type: 'pagi',
    openingBalance: 0,
    branchId: branches.data[0].id,
  });
  expect(opened.status, JSON.stringify(opened.data)).toBe(201);
  return { id: opened.data.id as string, openedHere: true };
}
