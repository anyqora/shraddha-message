import { describe, expect, it } from 'vitest';
import { escapeSearchTerm, filterValues, readField } from './fields';
import { OBJECTS, recordTitle } from './objects';

const contacts = OBJECTS.contacts;
const field = (key: string) => contacts.fields.find((f) => f.key === key)!;

describe('escapeSearchTerm', () => {
  it('escapes like wildcards and strips or() syntax', () => {
    expect(escapeSearchTerm(' 50%_off,(x) ')).toBe('50\\%\\_off  x');
  });
});

describe('filterValues', () => {
  it('normalizes values to a string list', () => {
    expect(filterValues(undefined)).toEqual([]);
    expect(filterValues('')).toEqual([]);
    expect(filterValues(3)).toEqual(['3']);
    expect(filterValues(['a', 1])).toEqual(['a', '1']);
  });
});

describe('readField', () => {
  const row = {
    id: 'c1',
    name: 'Asha',
    contact_tags: [{ tag_id: 't1', tags: { id: 't1', name: 'vip', color: '#000' } }, { tag_id: 't2', tags: null }],
  };

  it('reads tags from the contact_tags embed', () => {
    expect(readField(row, field('tags'))).toEqual([{ id: 't1', name: 'vip', color: '#000' }]);
  });

  it('reads custom values and plain columns', () => {
    const custom = { ...field('name'), key: 'custom:f1', virtual: true };
    expect(readField(row, custom, new Map([['f1', 'Pune']]))).toBe('Pune');
    expect(readField(row, custom)).toBe('');
    expect(readField(row, field('name'))).toBe('Asha');
  });
});

describe('recordTitle', () => {
  it('falls back to phone/email for contacts and Untitled otherwise', () => {
    expect(recordTitle(contacts, { id: '1', name: ' ', phone: '+1' })).toBe('+1');
    expect(recordTitle(contacts, { id: '1' })).toBe('Unnamed');
    expect(recordTitle(OBJECTS.tasks, { id: '1', title: '' })).toBe('Untitled');
  });
});
