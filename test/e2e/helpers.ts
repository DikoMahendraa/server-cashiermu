/**
 * Shared plumbing for the end-to-end tests. They talk to a running LOCAL API (`npm run dev`) using
 * throwaway accounts defined in .env.example, so they never touch real store data.
 */
import { readFileSync } from 'fs';
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

/** Logs in, registering the throwaway owner first if it does not exist yet. Returns the access token. */
export async function ensureOwner(account: { email: string; phone: string; storeName: string }): Promise<string> {
  let login = await call('', 'POST', '/auth/login', { credential: account.email, pin: e2eEnv.pin });
  if (login.status === 401) {
    const reg = await call('', 'POST', '/auth/register', {
      storeName: account.storeName,
      ownerName: 'E2E Owner',
      email: account.email,
      phone: account.phone,
      pin: e2eEnv.pin,
      pinConfirm: e2eEnv.pin,
    });
    expect(reg.status, JSON.stringify(reg.data)).toBe(201);
    login = await call('', 'POST', '/auth/login', { credential: account.email, pin: e2eEnv.pin });
  }
  expect(login.status, JSON.stringify(login.data)).toBe(200);
  expect(login.data.store.name).toBe(account.storeName); // guard: never run against a real store
  return login.data.accessToken as string;
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
