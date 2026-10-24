import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const json = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

describe('Spark-only staging Firestore configuration', () => {
  it('uses the existing closed rules and Johannesburg database without changing production config', () => {
    const config = json('./firebase.staging.json');
    expect(config).toEqual({ firestore: { database: '(default)', location: 'africa-south1', rules: 'firestore.rules', indexes: 'firestore.staging.indexes.json' } });
    expect(json('./firebase.json').firestore.indexes).toBe('firestore.indexes.json');
    expect(readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')).toContain('allow read, write: if false;');
  });
  it('preserves all composite indexes and exemptions, omitting only billing-required TTL for staging', () => {
    const production = json('./firestore.indexes.json');
    const staging = json('./firestore.staging.indexes.json');
    expect(staging.indexes).toEqual(production.indexes);
    expect(staging.fieldOverrides).toEqual(production.fieldOverrides.map(({ ttl: _ttl, ...remaining }: any) => remaining));
    expect(staging.fieldOverrides.every((field: any) => !Object.hasOwn(field, 'ttl'))).toBe(true);
    expect(production.fieldOverrides.some((field: any) => field.ttl === true)).toBe(true);
  });
});
