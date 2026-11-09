/**
 * Unit Tests: SOF entries → laytime stoppages (laytime-sof.ts), feeding laytime-statement.ts.
 * Sample voyage (invented): SHEX, 120 h, USD 15,000/day; hand answer USD 1,875.
 */
import { describe, it, expect } from 'vitest';
import { stoppagesFromSof, type SofEntryLike } from '../src/sof.js';
import { calculateLaytimeStatement } from '../src/statement.js';

const e = (id: string, eventType: string, at: string, extra: Partial<SofEntryLike> = {}): SofEntryLike => ({
  id, eventType, eventTime: new Date(at), timeUsed: 0, excluded: false, excludeReason: null, ...extra,
});

const statement = (entries: SofEntryLike[]) => {
  const { stoppages, unbounded } = stoppagesFromSof(entries);
  return calculateLaytimeStatement({
    commencedAt: new Date('2026-03-05T13:00:00Z'),
    completedAt: new Date('2026-03-11T20:00:00Z'),
    allowedHours: 120, exceptionRule: 'shex', demurrageRate: 15000, despatchRate: 7500,
    stoppages, ...(unbounded.length ? { determinacy: { unboundedStoppages: unbounded } } : {}),
  });
};

describe('stoppagesFromSof', () => {
  it('pairs rain_start (excluded) with the next rain_stop → USD 1,875', () => {
    const proof = statement([
      e('a', 'rain_start', '2026-03-06T14:00:00Z', { excluded: true, excludeReason: 'rain' }),
      e('b', 'rain_stop', '2026-03-06T18:00:00Z', { excluded: true }),
    ]);
    expect(proof.amountDue).toBe(1875);
    expect(proof.excludedHours).toBe(28);
  });

  it('uses timeUsed as the duration of a single excluded entry', () => {
    const { stoppages } = stoppagesFromSof([e('c', 'equipment_breakdown', '2026-03-06T14:00:00Z', { excluded: true, timeUsed: 4 })]);
    expect(stoppages).toHaveLength(1);
    expect(stoppages[0].end.toISOString()).toBe('2026-03-06T18:00:00.000Z');
    expect(stoppages[0].reason).toBe('equipment_breakdown');
  });

  it('ignores entries not marked excluded, and deleted entries', () => {
    const { stoppages, unbounded } = stoppagesFromSof([
      e('d', 'rain_start', '2026-03-06T14:00:00Z'),
      e('f', 'rain_stop', '2026-03-06T18:00:00Z'),
      e('g', 'customs_hold', '2026-03-07T10:00:00Z', { excluded: true, timeUsed: 2, deletedAt: new Date() }),
    ]);
    expect(stoppages).toHaveLength(0);
    expect(unbounded).toHaveLength(0);
  });

  it('an excluded entry with no end and no duration → the statement refuses (NULL)', () => {
    const proof = statement([e('h', 'rain_start', '2026-03-06T14:00:00Z', { excluded: true })]);
    expect(proof.result).toBe('NULL');
    expect(proof.amountDue).toBeNull();
    expect(proof.nulls[0].sourceRef).toContain('rain_start');
  });
});

// The resolvers' shared path, with a stand-in for the database (no DB touched).

// ─── Stored voyages: charter terms wired (added 27 Oct 2026) ──────────────────
import { usedPeriodsFromSof } from '../src/sof.js';

describe('usedPeriodsFromSof (SHEX unless used, from the SOF)', () => {
  it('pairs worked_start with the next worked_stop', () => {
    const r = usedPeriodsFromSof([e('w1', 'worked_start', '2026-03-08T08:00:00Z'), e('w2', 'worked_stop', '2026-03-08T16:00:00Z')]);
    expect(r.usedPeriods).toHaveLength(1);
    expect(r.usedPeriods![0].end.toISOString()).toBe('2026-03-08T16:00:00.000Z');
  });
  it('no worked entries and no statement → undefined (the SOF does not say)', () => {
    expect(usedPeriodsFromSof([e('r', 'rain_start', '2026-03-06T14:00:00Z')]).usedPeriods).toBeUndefined();
  });
  it("'no_excepted_day_work' → [] (the record says nothing was worked)", () => {
    expect(usedPeriodsFromSof([e('n', 'no_excepted_day_work', '2026-03-09T20:00:00Z')]).usedPeriods).toEqual([]);
  });
  it('a worked_start with no stop and no hours is unbounded', () => {
    expect(usedPeriodsFromSof([e('w', 'worked_start', '2026-03-08T08:00:00Z')]).unbounded).toHaveLength(1);
  });
});
