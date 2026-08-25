import { describe, it, expect } from 'vitest';
import { validateArgs } from '../../src/webmcp/validate';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['section_id', 'priority'],
  properties: {
    section_id: { type: 'string', enum: ['s1', 's2', 's3'] },
    priority: { type: 'integer', minimum: 1, maximum: 3 },
    note: { type: 'string', maxLength: 10 },
  },
};

describe('validateArgs', () => {
  it('accepts a valid object', () => {
    expect(validateArgs(schema, { section_id: 's2', priority: 1 })).toEqual({ ok: true });
  });
  it('rejects a missing required key with the key name in detail', () => {
    const r = validateArgs(schema, { section_id: 's2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('priority');
  });
  it('rejects a bad enum value', () => {
    const r = validateArgs(schema, { section_id: 'nope', priority: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('section_id');
  });
  it('rejects a non-integer where integer is required', () => {
    const r = validateArgs(schema, { section_id: 's1', priority: 1.5 });
    expect(r.ok).toBe(false);
  });
  it('rejects out-of-range integers', () => {
    expect(validateArgs(schema, { section_id: 's1', priority: 9 }).ok).toBe(false);
    expect(validateArgs(schema, { section_id: 's1', priority: 0 }).ok).toBe(false);
  });
  it('rejects unknown keys when additionalProperties is false', () => {
    const r = validateArgs(schema, { section_id: 's1', priority: 1, hack: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('hack');
  });
  it('rejects strings over maxLength', () => {
    expect(validateArgs(schema, { section_id: 's1', priority: 1, note: 'a'.repeat(11) }).ok).toBe(false);
  });
  it('validates arrays of objects via items', () => {
    const arr = {
      type: 'object', required: ['allocations'],
      properties: {
        allocations: {
          type: 'array', minItems: 1, maxItems: 6,
          items: {
            type: 'object', required: ['subsystem', 'amps'], additionalProperties: false,
            properties: {
              subsystem: { type: 'string', enum: ['drive', 'lights'] },
              amps: { type: 'integer', minimum: 0, maximum: 40 },
            },
          },
        },
      },
    };
    expect(validateArgs(arr, { allocations: [{ subsystem: 'drive', amps: 20 }] })).toEqual({ ok: true });
    expect(validateArgs(arr, { allocations: [{ subsystem: 'drive', amps: 99 }] }).ok).toBe(false);
    expect(validateArgs(arr, { allocations: [] }).ok).toBe(false);
  });
  it('rejects non-object roots for object schemas', () => {
    expect(validateArgs(schema, 'hi').ok).toBe(false);
    expect(validateArgs(schema, null).ok).toBe(false);
  });
});
