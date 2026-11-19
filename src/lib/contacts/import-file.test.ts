import { describe, expect, it } from 'vitest';
import {
  applyDefaultCountry,
  autoMapColumns,
  buildImportRows,
  cellToString,
  findImportCountry,
  mappingFromKey,
  mappingIssues,
  mappingKey,
  normalizeHeader,
  parseDelimited,
  tableFromRows,
} from './import-file';

describe('parseDelimited', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    const t = parseDelimited('﻿name,phone\r\n"Doe, ""J""",+1555\r\n');
    expect(t.headers).toEqual(['name', 'phone']);
    expect(t.rows).toEqual([['Doe, "J"', '+1555']]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseDelimited('a;b\n1;2').rows).toEqual([['1', '2']]);
    expect(parseDelimited('a\tb\n1\t2').rows).toEqual([['1', '2']]);
  });

  it('drops blank rows and pads short rows', () => {
    const t = parseDelimited('a,b,c\n\n1\n,,\n');
    expect(t.rows).toEqual([['1', '', '']]);
  });
});

describe('tableFromRows / cellToString', () => {
  it('names empty headers', () => {
    expect(tableFromRows([['phone', ''], ['1', '2']]).headers).toEqual(['phone', 'Column 2']);
  });

  it('stringifies Excel cells', () => {
    expect(cellToString(null)).toBe('');
    expect(cellToString(true)).toBe('true');
    expect(cellToString(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
    expect(cellToString(919876543210)).toBe('919876543210');
  });
});

describe('autoMapColumns', () => {
  it('maps aliases, existing custom fields and new custom fields once each', () => {
    const mapping = autoMapColumns(
      ['Mobile No', 'Customer Name', 'E-mail', 'Phone', 'Location', 'Order ID'],
      [{ id: 'f1', field_name: 'location' }],
      { canCreateFields: true },
    );
    expect(mapping).toEqual([
      { kind: 'phone' },
      { kind: 'name' },
      { kind: 'email' },
      { kind: 'new_custom', name: 'Phone' },
      { kind: 'custom', fieldId: 'f1' },
      { kind: 'new_custom', name: 'Order ID' },
    ]);
  });

  it('ignores unknown columns when fields cannot be created', () => {
    expect(autoMapColumns(['Order ID'], [])).toEqual([{ kind: 'ignore' }]);
  });

  it('normalizes headers', () => {
    expect(normalizeHeader('  WhatsApp_No. ')).toBe('whatsapp no');
  });
});

describe('mapping keys and issues', () => {
  it('round-trips keys', () => {
    for (const m of [{ kind: 'phone' }, { kind: 'custom', fieldId: 'x' }, { kind: 'new_custom', name: 'A b' }] as const) {
      expect(mappingFromKey(mappingKey(m))).toEqual(m);
    }
  });

  it('requires a phone column and flags duplicates', () => {
    expect(mappingIssues([{ kind: 'name' }])).toEqual([{ code: 'no_phone' }]);
    expect(mappingIssues([{ kind: 'phone' }, { kind: 'phone' }, { kind: 'ignore' }, { kind: 'ignore' }])).toEqual([
      { code: 'duplicate_target', target: 'phone' },
    ]);
  });
});

describe('applyDefaultCountry', () => {
  const IN = findImportCountry('in');
  it('adds the country code to national numbers', () => {
    expect(applyDefaultCountry('98765 43210', IN)).toBe('+919876543210');
    expect(applyDefaultCountry('09876543210', IN)).toBe('+919876543210');
    expect(applyDefaultCountry('919876543210', IN)).toBe('+919876543210');
    expect(applyDefaultCountry('0091 98765 43210', IN)).toBe('+919876543210');
  });

  it('leaves + numbers, unknown lengths and no-country alone', () => {
    expect(applyDefaultCountry('+14155550123', IN)).toBe('+14155550123');
    expect(applyDefaultCountry('12345', IN)).toBe('12345');
    expect(applyDefaultCountry('9876543210', null)).toBe('9876543210');
  });
});

describe('buildImportRows', () => {
  it('builds rows from the mapping', () => {
    const table = { headers: ['p', 'n', 't', 'o', 'c', 'x'], rows: [['9876543210', 'Asha', 'vip; lead', 'yes', 'Pune', 'A-1']] };
    const rows = buildImportRows(
      table,
      [
        { kind: 'phone' },
        { kind: 'name' },
        { kind: 'tags' },
        { kind: 'opt_out' },
        { kind: 'custom', fieldId: 'f1' },
        { kind: 'new_custom', name: 'Order' },
      ],
      findImportCountry('IN'),
    );
    expect(rows).toEqual([
      {
        phone: '+919876543210',
        name: 'Asha',
        tagNames: ['vip', 'lead'],
        optedOut: true,
        customValues: { f1: 'Pune' },
        newCustomValues: { Order: 'A-1' },
      },
    ]);
  });
});
