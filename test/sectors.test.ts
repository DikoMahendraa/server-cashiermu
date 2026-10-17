import { BusinessSector } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { SECTORS, getSectorConfig, getSubtypeConfig, isValidSubtype } from '../src/modules/sectors/sector.config';
import type { Vocabulary } from '../src/modules/sectors/sector.types';
import { resolveTrackStockDefault, validateAttributes } from '../src/modules/sectors/sector.validation';

const kind = (sector: BusinessSector, subtype: string) => getSubtypeConfig(sector, subtype);
const ALL_KINDS = SECTORS.flatMap(sector =>
  sector.subtypes.map(subtype => [`${sector.id}/${subtype.id}`, sector, subtype] as const),
);

describe('sector config integrity', () => {
  it('has exactly one config per BusinessSector enum value (the 3 supported types)', () => {
    expect(SECTORS.map(s => s.id).sort()).toEqual(Object.values(BusinessSector).sort());
    expect(Object.values(BusinessSector).sort()).toEqual(['culinary', 'general', 'service']);
  });

  it('lists the agreed kinds', () => {
    expect(getSectorConfig('general').subtypes.map(s => s.id)).toEqual(['default']);
    expect(getSectorConfig('culinary').subtypes.map(s => s.id)).toEqual(['food', 'beverage', 'food_beverage']);
    expect(getSectorConfig('service').subtypes.map(s => s.id)).toEqual([
      'ac',
      'laundry',
      'workshop',
      'massage',
      'printing',
      'general_service',
    ]);
  });

  it.each(SECTORS.map(s => [s.id, s] as const))(
    '%s: kind ids are unique and the default kind exists',
    (_id, sector) => {
      const ids = sector.subtypes.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(sector.defaultSubtype);
    },
  );

  it.each(ALL_KINDS)('%s: wording, units, categories and fields are well formed', (_name, _sector, config) => {
    // every word the app needs is present
    for (const [key, value] of Object.entries(config.vocabulary)) {
      expect(value, `vocabulary.${key}`).toBeTruthy();
    }
    expect(Object.keys(config.vocabulary).sort()).toEqual(
      Object.keys(getSubtypeConfig('general', 'default').vocabulary).sort(),
    );

    // units
    expect(config.units.length).toBeGreaterThan(0);
    const unitValues = config.units.map(u => u.value);
    expect(new Set(unitValues).size, 'duplicate unit values').toBe(unitValues.length);
    expect(unitValues, 'defaultUnit must be one of the units').toContain(config.defaultUnit);

    // categories
    expect(config.categories.length).toBeGreaterThan(0);
    expect(new Set(config.categories.map(c => c.name)).size, 'duplicate category names').toBe(config.categories.length);

    // fields
    const keys = config.fields.map(f => f.key);
    expect(new Set(keys).size, 'duplicate field keys').toBe(keys.length);
    for (const field of config.fields) {
      if (field.type === 'select' || field.type === 'multiselect') {
        expect(field.options?.length, `${field.key} needs options`).toBeGreaterThan(0);
        const values = field.options!.map(o => o.value);
        expect(new Set(values).size, `${field.key} duplicate option values`).toBe(values.length);
      }
      if (field.showWhen) {
        const target = config.fields.find(f => f.key === field.showWhen!.field);
        expect(target, `${field.key} showWhen points to a missing field`).toBeDefined();
        if (target!.type === 'select') expect(target!.options!.map(o => o.value)).toContain(field.showWhen.equals);
        expect(target!.showWhen, `${field.key}: chained showWhen is not supported`).toBeUndefined();
      }
      if (field.trackStockByValue) {
        expect(field.type).toBe('select');
        expect(Object.keys(field.trackStockByValue).sort()).toEqual(field.options!.map(o => o.value).sort());
      }
      if (field.min !== undefined && field.max !== undefined) expect(field.min).toBeLessThanOrEqual(field.max);
    }

    // variant presets
    for (const preset of config.variantPresets) {
      expect(preset.options.length).toBeGreaterThan(0);
      expect(new Set(preset.options).size).toBe(preset.options.length);
    }
  });

  it.each(ALL_KINDS)('%s: every starter template is valid for its own kind', (_name, sector, config) => {
    const categoryNames = config.categories.map(c => c.name);
    const unitMap = new Map(config.units.map(u => [u.value, u]));
    const names = config.templates.map(t => t.name);
    expect(new Set(names).size, 'duplicate template names').toBe(names.length);

    for (const template of config.templates) {
      expect(categoryNames, `${template.name}: unknown category "${template.category}"`).toContain(template.category);
      expect(unitMap.has(template.unit), `${template.name}: unit "${template.unit}" is not offered by this kind`).toBe(
        true,
      );

      // the attributes must pass the very validator the server applies
      const result = validateAttributes(config, template.attributes ?? {});
      expect(result.ok, `${template.name}: ${JSON.stringify(result)}`).toBe(true);
      // ...and trackStock must agree with what the kind's rules would pick
      expect(template.trackStock, `${template.name}: trackStock`).toBe(
        resolveTrackStockDefault(config, template.attributes ?? {}),
      );
      // fractional units can only be used without a stock count
      if (unitMap.get(template.unit)!.decimal)
        expect(template.trackStock, `${template.name}: decimal unit but tracked`).toBe(false);
    }
    void sector;
  });

  it('keeps Retail / Umum identical to how every store behaved before sectors', () => {
    const general = kind('general', 'default');
    expect(general.fields).toEqual([]);
    expect(general.trackStockDefault).toBe(true);
    expect(general.categories.map(c => c.name)).toEqual(['Makanan', 'Minuman', 'Lainnya']);
    expect(general.units.map(u => u.value)).toEqual([
      'pcs',
      'porsi',
      'gelas',
      'cup',
      'botol',
      'bungkus',
      'kotak',
      'pak',
      'kg',
      'gram',
      'liter',
      'ml',
    ]);
    expect(general.units.some(u => u.decimal)).toBe(false);
    expect(general.vocabulary.item).toBe('Produk');
    expect(general.templates).toEqual([]);
  });

  it('uses the right word for the item in each type', () => {
    const word = (sector: BusinessSector, subtype: string): Vocabulary['item'] => kind(sector, subtype).vocabulary.item;
    expect(word('general', 'default')).toBe('Produk');
    expect(word('culinary', 'beverage')).toBe('Menu');
    expect(word('service', 'laundry')).toBe('Layanan');
    expect(kind('service', 'laundry').vocabulary.addItem).toBe('Tambah Layanan');
    expect(kind('service', 'laundry').vocabulary.costLabel).toContain('Modal');
  });

  it('gives each kind its own placeholders and units', () => {
    expect(kind('service', 'laundry').vocabulary.namePlaceholder).toContain('Cuci Kiloan');
    expect(kind('service', 'workshop').vocabulary.namePlaceholder).toContain('Oli');
    expect(kind('service', 'laundry').defaultUnit).toBe('kg');
    expect(kind('service', 'laundry').units.find(u => u.value === 'kg')?.decimal).toBe(true);
    expect(kind('service', 'printing').defaultUnit).toBe('lembar');
    expect(kind('culinary', 'beverage').defaultUnit).toBe('gelas');
    expect(kind('culinary', 'food').defaultUnit).toBe('porsi');
  });

  it('never shows food wording in a service kind (variant hint, placeholders, presets)', () => {
    const foodWords = /pedas|topping|sugar|ice level|porsi|boba/i;
    for (const subtype of getSectorConfig('service').subtypes) {
      const v = subtype.vocabulary;
      const text = JSON.stringify([
        v.variantSection,
        v.variantHint,
        v.variantGroupPlaceholder,
        v.variantOptionPlaceholder,
        v.notePlaceholder,
        subtype.variantPresets,
      ]);
      expect(text, `${subtype.id}: ${text}`).not.toMatch(foodWords);
      expect(text, `${subtype.id}: ${text}`).not.toMatch(/bawang/i);
    }
  });

  it('never calls a service business a shop or its cart a basket', () => {
    for (const subtype of getSectorConfig('service').subtypes) {
      const v = subtype.vocabulary;
      expect([v.cartNoun, v.businessNoun, v.item].join(' '), subtype.id).not.toMatch(/keranjang|toko|produk/i);
      expect(v.cartNoun).toBe('Daftar Layanan');
      expect(v.businessNoun).toBe('Usaha');
    }
    expect(kind('culinary', 'food').vocabulary).toMatchObject({ cartNoun: 'Pesanan', businessNoun: 'Usaha' });
    // Retail is unchanged
    expect(kind('general', 'default').vocabulary).toMatchObject({ cartNoun: 'Keranjang', businessNoun: 'Toko' });
  });

  it('gives each kind a note example that fits its trade', () => {
    expect(kind('service', 'laundry').vocabulary.notePlaceholder).toContain('pewangi');
    expect(kind('service', 'workshop').vocabulary.notePlaceholder).toContain('plat nomor');
    expect(kind('culinary', 'food').vocabulary.notePlaceholder).toContain('pedas');
    expect(kind('culinary', 'beverage').vocabulary.notePlaceholder).toContain('sugar');
    const notes = ALL_KINDS.map(([, , config]) => config.vocabulary.notePlaceholder);
    expect(notes.every(note => note.startsWith('Contoh: '))).toBe(true);
  });

  it('gives every kind its own variant wording and at least one quick-add suggestion', () => {
    for (const [name, , config] of ALL_KINDS) {
      expect(config.variantPresets.length, `${name} has no variant presets`).toBeGreaterThan(0);
      expect(config.vocabulary.variantHint, name).toMatch(/^Contoh: /);
    }
    // services each say something different, not one shared sentence
    const hints = getSectorConfig('service').subtypes.map(subtype => subtype.vocabulary.variantHint);
    expect(new Set(hints).size).toBe(hints.length);
    expect(kind('service', 'laundry').vocabulary.variantHint).toContain('pewangi');
    expect(kind('culinary', 'beverage').vocabulary.variantHint).toContain('sugar level');
    expect(kind('general', 'default').vocabulary.variantHint).toBe('Contoh: ukuran, warna.');
  });

  it('resolves `default` and unknown kinds to the sector default', () => {
    expect(getSubtypeConfig('service', 'default').id).toBe('general_service');
    expect(getSubtypeConfig('culinary', 'default').id).toBe('food_beverage');
    expect(getSubtypeConfig('service', 'bakery').id).toBe('general_service');
    expect(isValidSubtype('service', 'default')).toBe(true);
    expect(isValidSubtype('service', 'laundry')).toBe(true);
    expect(isValidSubtype('service', 'food')).toBe(false);
    expect(isValidSubtype('general', 'laundry')).toBe(false);
  });
});

describe('validateAttributes', () => {
  it('accepts anything empty for kinds without required fields', () => {
    expect(validateAttributes(kind('general', 'default'), {})).toEqual({ ok: true, value: {} });
    expect(validateAttributes(kind('general', 'default'), undefined)).toEqual({ ok: true, value: {} });
    expect(validateAttributes(kind('culinary', 'food'), null)).toEqual({ ok: true, value: {} });
    expect(validateAttributes(kind('service', 'laundry'), {})).toEqual({ ok: true, value: {} });
  });

  it('rejects unknown keys so typos and stale data never get stored', () => {
    const result = validateAttributes(kind('culinary', 'food'), { prepTimeMinutes: 5, colour: 'red' });
    expect(result).toEqual({ ok: false, errors: { colour: expect.stringContaining('tidak dikenal') } });
    expect(validateAttributes(kind('general', 'default'), { anything: 1 }).ok).toBe(false);
    // fields of another kind are unknown here too
    expect(validateAttributes(kind('service', 'laundry'), { paperSize: 'a4' }).ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validateAttributes(kind('culinary', 'food'), 'x')).toMatchObject({
      ok: false,
      errors: { _: expect.any(String) },
    });
    expect(validateAttributes(kind('culinary', 'food'), [1])).toMatchObject({ ok: false });
  });

  it('checks numbers: type, min and max', () => {
    const c = kind('culinary', 'food');
    expect(validateAttributes(c, { prepTimeMinutes: 15 })).toEqual({ ok: true, value: { prepTimeMinutes: 15 } });
    expect(validateAttributes(c, { prepTimeMinutes: 0 })).toMatchObject({ ok: true });
    expect(validateAttributes(c, { prepTimeMinutes: '15' })).toMatchObject({
      ok: false,
      errors: { prepTimeMinutes: 'harus berupa angka' },
    });
    expect(validateAttributes(c, { prepTimeMinutes: -1 })).toMatchObject({
      ok: false,
      errors: { prepTimeMinutes: 'minimal 0' },
    });
    expect(validateAttributes(c, { prepTimeMinutes: 1441 })).toMatchObject({
      ok: false,
      errors: { prepTimeMinutes: 'maksimal 1440' },
    });
    expect(validateAttributes(c, { prepTimeMinutes: Number.NaN }).ok).toBe(false);
    expect(validateAttributes(c, { prepTimeMinutes: Infinity }).ok).toBe(false);
  });

  it('checks multiselect values and duplicates', () => {
    const c = kind('culinary', 'food');
    expect(validateAttributes(c, { servingTypes: ['dine_in', 'takeaway'] })).toMatchObject({ ok: true });
    expect(validateAttributes(c, { servingTypes: ['dine_in', 'drone'] })).toMatchObject({
      ok: false,
      errors: { servingTypes: 'pilihan tidak valid' },
    });
    expect(validateAttributes(c, { servingTypes: ['dine_in', 'dine_in'] })).toMatchObject({
      ok: false,
      errors: { servingTypes: expect.stringContaining('duplikat') },
    });
    expect(validateAttributes(c, { servingTypes: 'dine_in' }).ok).toBe(false);
  });

  it('trims text, enforces max length, and drops blank optional values', () => {
    const w = kind('service', 'workshop');
    const base = { kind: 'part' };
    expect(validateAttributes(w, { ...base, partBrand: '  Federal  ' })).toEqual({
      ok: true,
      value: { kind: 'part', partBrand: 'Federal' },
    });
    expect(validateAttributes(w, { ...base, partBrand: '   ' })).toEqual({ ok: true, value: { kind: 'part' } });
    expect(validateAttributes(w, { ...base, partBrand: 'x'.repeat(61) })).toMatchObject({
      ok: false,
      errors: { partBrand: 'maksimal 60 karakter' },
    });
    expect(validateAttributes(w, { ...base, partBrand: 5 }).ok).toBe(false);
  });

  it('checks required fields only while they are visible', () => {
    const m = kind('service', 'massage');
    expect(validateAttributes(m, {})).toMatchObject({ ok: false, errors: { durationMinutes: 'wajib diisi' } });
    expect(validateAttributes(m, { durationMinutes: 60 })).toEqual({ ok: true, value: { durationMinutes: 60 } });

    const w = kind('service', 'workshop');
    expect(validateAttributes(w, {})).toMatchObject({ ok: false, errors: { kind: 'wajib diisi' } });
    expect(validateAttributes(w, { kind: 'service' })).toEqual({ ok: true, value: { kind: 'service' } });
    expect(validateAttributes(w, { kind: 'part' })).toEqual({ ok: true, value: { kind: 'part' } });
  });

  it('drops fields hidden by showWhen so switching type leaves no stale data', () => {
    const w = kind('service', 'workshop');
    const result = validateAttributes(w, {
      kind: 'part',
      durationMinutes: 45,
      warrantyDays: 30,
      partBrand: 'NGK',
      partNumber: 'CR7',
    });
    expect(result).toEqual({ ok: true, value: { kind: 'part', partBrand: 'NGK', partNumber: 'CR7' } });

    const asService = validateAttributes(w, { kind: 'service', durationMinutes: 45, partBrand: 'NGK' });
    expect(asService).toEqual({ ok: true, value: { kind: 'service', durationMinutes: 45 } });
  });

  it('validates select options (laundry speed, printing paper size)', () => {
    expect(validateAttributes(kind('service', 'laundry'), { speed: 'express' })).toMatchObject({ ok: true });
    expect(validateAttributes(kind('service', 'laundry'), { speed: 'turbo' })).toMatchObject({
      ok: false,
      errors: { speed: 'pilihan tidak valid' },
    });
    const p = kind('service', 'printing');
    expect(validateAttributes(p, { kind: 'service', paperSize: 'a4', colorMode: 'color' })).toMatchObject({ ok: true });
    // goods (ATK) do not use paper size, so it is dropped
    expect(validateAttributes(p, { kind: 'goods', paperSize: 'a4' })).toEqual({ ok: true, value: { kind: 'goods' } });
  });

  it('collects every error at once so the form can show them together', () => {
    const result = validateAttributes(kind('service', 'workshop'), {
      kind: 'service',
      durationMinutes: 'abc',
      bogus: 1,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: { durationMinutes: 'harus berupa angka', bogus: expect.any(String) },
    });
    expect(validateAttributes(kind('service', 'massage'), { bogus: 1 })).toMatchObject({
      ok: false,
      errors: { durationMinutes: 'wajib diisi', bogus: expect.any(String) },
    });
  });
});

describe('resolveTrackStockDefault', () => {
  it('uses the kind default, and a select field mapping when present', () => {
    expect(resolveTrackStockDefault(kind('general', 'default'), {})).toBe(true);
    expect(resolveTrackStockDefault(kind('culinary', 'food'), {})).toBe(true);
    expect(resolveTrackStockDefault(kind('service', 'laundry'), {})).toBe(false);
    expect(resolveTrackStockDefault(kind('service', 'workshop'), { kind: 'service' })).toBe(false);
    expect(resolveTrackStockDefault(kind('service', 'workshop'), { kind: 'part' })).toBe(true);
    expect(resolveTrackStockDefault(kind('service', 'printing'), { kind: 'goods' })).toBe(true);
    expect(resolveTrackStockDefault(kind('service', 'workshop'), {})).toBe(false);
  });
});
