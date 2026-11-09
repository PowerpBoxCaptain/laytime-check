/**
 * Unit tests: laytime case builder (laytime-case.ts). Synthetic case only — no real fixture data in this repo.
 * SHINC, 48 h allowed (24,000 MT at 12,000/day), USD 24,000/day demurrage (USD 1,000/h), despatch half.
 */
import { describe, it, expect } from 'vitest';
import { runCase, type CaseFile } from '../src/case.js';

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

describe('runCase', () => {
  it('computes the full product of readings, keyed by reading ids', () => {
    const run = runCase(base());
    expect(run.cells.map((c) => c.key)).toEqual(['N0.C0', 'N0.C1', 'N1.C0', 'N1.C1']);
  });

  it('owners on both points: 60 h gross − 2 h rain = 58 h used → 10 h demurrage = USD 10,000', () => {
    const c = runCase(base()).cells.find((x) => x.key === 'N0.C0')!;
    expect(c.result).toBe('on_demurrage');
    expect(c.overHours).toBeCloseTo(10, 9);
    expect(c.total).toBeCloseTo(10000, 6);
    expect(c.demurrageFrom?.toISOString()).toBe('2026-06-03T02:00:00.000Z');
  });

  it('a reading that sets commencement moves laytime start; add-on applies only under its combination', () => {
    const run = runCase(base());
    const n1c0 = run.cells.find((x) => x.key === 'N1.C0')!;
    expect(n1c0.usedHours).toBeCloseTo(48, 9); // 12:00 01 → 12:00 03, rain before start
    expect(n1c0.result).toBe('within_laytime'); // exactly 48 used vs 48 allowed: neither demurrage nor despatch
    expect(n1c0.addOns).toEqual([{ id: 'detention', hours: 6, amount: 6000 }]);
    expect(n1c0.total).toBeCloseTo(6000, 6);
    expect(run.cells.find((x) => x.key === 'N1.C1')!.addOns).toEqual([]);
  });

  it('swing per point holds the other points at their first reading', () => {
    const run = runCase(base());
    const nor = run.swing.find((s) => s.point === 'nor')!;
    expect(nor.max).toBeCloseTo(10000, 6);
    expect(nor.min).toBeCloseTo(6000, 6);
    expect(run.range!.max).toBeCloseTo(10000, 6);
  });

  it('missing quantity → NULL result with a break-even quantity, never a figure (CHRT-008)', () => {
    const c = runCase(base({ quantityMt: null })).cells.find((x) => x.key === 'N0.C0')!;
    expect(c.result).toBe('NULL');
    expect(c.total).toBeNull();
    expect(c.usedHours).toBeCloseTo(58, 9);
    expect(c.breakEvenMt).toBeCloseTo(29000, 6); // 58 h at 12,000 MT/day
    expect(c.nulls.join(' ')).toContain('quantity');
  });

  it('missing demurrage rate → hours, no money', () => {
    const c = runCase(base({ demurrageRate: null, despatchRate: null })).cells.find((x) => x.key === 'N0.C0')!;
    expect(c.overHours).toBeCloseTo(10, 9);
    expect(c.laytimeAmount).toBeNull();
    expect(c.total).toBeNull();
  });

  it('no commencement anywhere → NULL with the reason named', () => {
    const f = base();
    f.points[0].readings.forEach((r) => delete r.commencedAt);
    const c = runCase(f).cells[0];
    expect(c.result).toBe('NULL');
    expect(c.nulls[0]).toContain('commencement');
  });
});

describe('runCase money (found by reconciling with the public clean-room calculator, 9 Nov 2026)', () => {
  it('no despatch rate → despatch NULL, never zero', () => {
    const c = runCase(base({ completedAt: t('02T12:00'), despatchRate: null })).cells.find((x) => x.key === 'N0.C0')!;
    expect(c.overHours!).toBeLessThan(0);
    expect(c.laytimeAmount).toBeNull();
  });
  it('despatch on all time saved takes the statement figure, not laytime saved', () => {
    const f = base({ completedAt: t('02T12:00'), exceptionRule: 'shinc' });
    const saved = runCase(f).cells.find((x) => x.key === 'N0.C0')!;
    const all = runCase(base({ completedAt: t('02T12:00'), despatchBasis: 'all_time_saved' })).cells.find((x) => x.key === 'N0.C0')!;
    expect(saved.laytimeAmount).toBeCloseTo(all.laytimeAmount!, 6); // SHINC: every minute counts, so both bases agree
  });
});
