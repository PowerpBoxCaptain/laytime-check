/**
 * Unit tests: sheet check (check.ts). Synthetic case only — no real fixture data in this repo.
 * SHINC, 48 h allowed (24,000 MT at 12,000/day), USD 24,000/day demurrage (USD 1,000/h), despatch half.
 */
import { describe, it, expect } from 'vitest';
import type { CaseFile } from '../src/case.js';
import { checkSheet, caseFromJson } from '../src/check.js';

const t = (s: string) => new Date(`2026-06-${s}:00Z`);

const base = (over: Partial<CaseFile['terms']> = {}): CaseFile => ({
  id: 'synthetic-1', title: 'Synthetic',
  terms: { quantityMt: 24000, ratePerDayMt: 12000, exceptionRule: 'shinc', completedAt: t('03T12:00'),
    demurrageRate: 24000, despatchRate: 12000, ...over },
  quotes: [{ field: 'rate', text: '12,000 MT PWWD SHINC', source: 'recap cl.8' }],
  base: [{ start: t('01T10:00'), end: t('01T12:00'), reason: 'rain', sourceRef: 'SOF p1' }],
  points: [
    { id: 'nor', title: 'NOR', facts: 'NOR before arrival', readings: [
      { id: 'N0', label: 'valid', why: 'arrived', side: 'owners', commencedAt: t('01T00:00') },
      { id: 'N1', label: 'invalid', why: 'not arrived', side: 'charterers', commencedAt: t('01T12:00') },
    ] },
    { id: 'crane', title: 'Crane', facts: '1 of 4 cranes down 24 h', readings: [
      { id: 'C0', label: 'counts', why: 'stevedore damage', side: 'owners' },
      { id: 'C1', label: 'pro rata', why: 'ship gear', side: 'charterers',
        stoppages: [{ start: t('02T00:00'), end: t('03T00:00'), reason: 'crane', countFraction: 0.75, appliesOnDemurrage: true }] },
    ] },
  ],
  addOns: [{ id: 'detention', label: 'detention', hours: 6, when: { nor: 'N1', crane: 'C0' } }],
});

describe('checkSheet', () => {
  it('named readings that reproduce the sheet → agrees, with a ledger that adds up', () => {
    const r = checkSheet(base(), { amount: 10000, kind: 'demurrage', readings: { nor: 'N0', crane: 'C0' } });
    expect(r.verdict).toBe('agrees');
    expect(r.named!.agrees).toBe(true);
    expect(r.named!.traceProblems).toEqual([]);
    expect(r.named!.ledger.join('\n')).toContain('EXCLUDED — Stoppage — rain [SOF p1]');
  });

  it('no readings named → finds which readings the sheet took', () => {
    const r = checkSheet(base(), { amount: 10000, kind: 'demurrage' });
    expect(r.verdict).toBe('reproduced');
    expect(r.matches.map((m) => m.key)).toEqual(['N0.C0']);
  });

  it('named readings that do not reproduce it, but others do → agrees-under-other-readings, difference stated', () => {
    const r = checkSheet(base(), { amount: 6000, kind: 'demurrage', readings: { nor: 'N0', crane: 'C0' } });
    expect(r.verdict).toBe('agrees-under-other-readings');
    expect(r.named!.difference).toBeCloseTo(4000, 6);
    expect(r.matches.map((m) => m.key)).toEqual(['N1.C0']); // 48 h within laytime + 6 h detention
  });

  it('a figure no reading reproduces → differs, with the nearest cell', () => {
    const r = checkSheet(base(), { amount: 9000, kind: 'demurrage' });
    expect(r.verdict).toBe('differs');
    expect(r.matches).toEqual([]);
    expect(r.nearest!.key).toBe('N0.C0');
    expect(r.nearest!.difference).toBeCloseTo(1000, 6);
  });

  it('despatch is negative internally; a demurrage claim never matches a despatch cell', () => {
    const r = checkSheet(base(), { amount: 10000, kind: 'despatch' });
    expect(r.sheet.signed).toBe(-10000);
    expect(r.verdict).toBe('differs');
  });

  it('missing quantity → null verdict, nothing filled in', () => {
    const r = checkSheet(base({ quantityMt: null }), { amount: 10000, kind: 'demurrage' });
    expect(r.verdict).toBe('null');
    expect(r.nulls.join(' ')).toContain('quantity');
  });

  it('a reading id that does not exist is refused', () => {
    expect(() => checkSheet(base(), { amount: 1, kind: 'demurrage', readings: { nor: 'NX', crane: 'C0' } })).toThrow(/nor/);
  });

  it('caseFromJson revives ISO dates, so a JSON round trip gives the same check', () => {
    const json = JSON.parse(JSON.stringify(base()));
    const r = checkSheet(caseFromJson(json), { amount: 10000, kind: 'demurrage' });
    expect(r.matches.map((m) => m.key)).toEqual(['N0.C0']);
  });

  it('caseFromJson refuses a bad date', () => {
    const json = JSON.parse(JSON.stringify(base()));
    json.terms.completedAt = 'yesterday';
    expect(() => caseFromJson(json)).toThrow(/completedAt/);
  });
});
