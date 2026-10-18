// Cell parsers and formatters for product import/export. Pure functions, so every rule is unit-tested.
// People type Indonesian-style numbers ("Rp 15.000"), "Ya"/"Tidak", dates as DD/MM/YYYY, and choices by their
// visible label, so parsing is deliberately forgiving about format but strict about meaning.

import type { FieldOption } from '../../sectors/sector.types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

export const isBlankCell = (raw: unknown): boolean =>
  raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');

/** Lower-case, letters and digits only, single spaces: "Express (1 hari)" → "express 1 hari". */
export const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function parseText(raw: unknown, maxLength = 200): Parsed<string> {
  if (typeof raw === 'boolean') return fail('harus berupa teks');
  const text = (typeof raw === 'number' ? String(raw) : String(raw ?? '')).trim();
  if (text.length > maxLength) return fail(`maksimal ${maxLength} karakter`);
  return ok(text);
}

/**
 * Accepts 15000, "15000", "Rp 15.000", "15.000,50" (Indonesian), "15,000.50" (English) and "15,5".
 * Rejects negatives and anything that is not a plain number.
 */
export function parseNumber(raw: unknown): Parsed<number> {
  if (typeof raw === 'boolean') return fail('harus berupa angka (mis. 15000)');
  if (typeof raw === 'number')
    return Number.isFinite(raw)
      ? raw < 0
        ? fail('tidak boleh negatif')
        : ok(raw)
      : fail('harus berupa angka (mis. 15000)');

  let text = String(raw ?? '')
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/\s/g, '');
  if (text.startsWith('-')) return fail('tidak boleh negatif');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(text)) text = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return fail('harus berupa angka (mis. 15000)');
  return ok(Number(text));
}

export function parseInteger(raw: unknown): Parsed<number> {
  const parsed = parseNumber(raw);
  if (!parsed.ok) return parsed;
  return Number.isInteger(parsed.value) ? parsed : fail('harus bilangan bulat');
}

const YES = new Set(['ya', 'y', 'yes', 'true', '1', 'aktif', 'benar']);
const NO = new Set(['tidak', 't', 'no', 'n', 'false', '0', 'nonaktif', 'salah']);

export function parseBoolean(raw: unknown): Parsed<boolean> {
  if (typeof raw === 'boolean') return ok(raw);
  if (typeof raw === 'number')
    return raw === 1 ? ok(true) : raw === 0 ? ok(false) : fail('isi dengan "Ya" atau "Tidak"');
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (YES.has(text)) return ok(true);
  if (NO.has(text)) return ok(false);
  return fail('isi dengan "Ya" atau "Tidak"');
}

/** Matches an option by its visible label or its stored value, ignoring case, spacing and punctuation. */
export function parseSelect(raw: unknown, options: FieldOption[]): Parsed<string> {
  const wanted = normalise(String(raw ?? ''));
  const match = options.find(option => normalise(option.label) === wanted || normalise(option.value) === wanted);
  if (match) return ok(match.value);
  return fail(`"${String(raw).trim()}" tidak dikenal. Pilihan: ${options.map(option => option.label).join(', ')}`);
}

/** Several choices in one cell, separated by comma, semicolon, pipe or new line. */
export function parseMultiselect(raw: unknown, options: FieldOption[]): Parsed<string[]> {
  const parts = String(raw ?? '')
    .split(/[,;|\n]/)
    .map(part => part.trim())
    .filter(Boolean);
  const values: string[] = [];
  for (const part of parts) {
    const parsed = parseSelect(part, options);
    if (!parsed.ok) return parsed;
    if (!values.includes(parsed.value)) values.push(parsed.value);
  }
  return ok(values);
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY and Excel serial numbers. Returns YYYY-MM-DD. */
export function parseDate(raw: unknown): Parsed<string> {
  const invalid = 'harus berupa tanggal yang valid (mis. 2027-12-31 atau 31/12/2027)';
  if (typeof raw === 'number') {
    if (raw < 20000 || raw > 80000) return fail(invalid);
    // Floor, not round: 31 Dec at 18:00 is still 31 Dec (Excel stores the time as a fraction of the day)
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000); // Excel's day 0
    return ok(`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`);
  }
  const text = String(raw ?? '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match && isRealDate(+match[1], +match[2], +match[3])) return ok(text);
  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match && isRealDate(+match[3], +match[2], +match[1]))
    return ok(`${match[3]}-${pad(+match[2])}-${pad(+match[1])}`);
  return fail(invalid);
}

/** A readable, repeatable SKU from a name: "Cuci Kiloan Reguler" → "CUCI-KILOAN-REGULER". */
export function slugSku(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return slug || 'ITEM';
}
