/**
 * Unit Tests: pro-rata stoppages in the laytime statement (crane breakdown clauses).
 *
 * Clause shape (common in bulk recaps): "in case of crane breakdown ... actual working time lost
 * not to count as laytime and laytime to be prorated according to the number of working cranes."
 * A stoppage with countFraction = workingCranes / totalCranes: that share of the period still counts.
 *
 * SHINC throughout, so only the stoppages move the clock. Demurrage USD 24,000/day = USD 1,000/hour.
 */

import { describe, it, expect } from 'vitest';
import { calculateLaytimeStatement, type LaytimeStatementInput } from '../src/statement.js';

const t = (s: string) => new Date(`${s}:00Z`);

const base = (over: Partial<LaytimeStatementInput>): LaytimeStatementInput => ({
  commencedAt: t('2026-06-01T00:00'),
  completedAt: t('2026-06-03T12:00'), // 60 h gross
  allowedHours: 48,
  exceptionRule: 'shinc',
  demurrageRate: 24000,
  despatchRate: 12000,
  currency: 'USD',
  ...over,
});

describe('Pro-rata stoppage (crane breakdown, countFraction)', () => {
  it('1 of 4 cranes down for 24 h → 6 h excluded, 54 h used, 6 h demurrage = USD 6,000', () => {
    const proof = calculateLaytimeStatement(base({
      stoppages: [{ start: t('2026-06-01T00:00'), end: t('2026-06-02T00:00'), reason: 'crane #2 breakdown', countFraction: 0.75, sourceRef: 'SOF p1' }],
    }));
    expect(proof.result).toBe('on_demurrage');
    expect(proof.excludedHours).toBeCloseTo(6, 9);
    expect(proof.usedHours).toBeCloseTo(54, 9);
    expect(proof.amountDue).toBeCloseTo(6000, 6);
    expect(proof.exclusions[0].reason).toContain('pro rata: 75% counts');
    expect(proof.exclusions[0].hours).toBeCloseTo(6, 9);
  });

  it('absent countFraction keeps the old behaviour: the whole period is excluded', () => {
    const proof = calculateLaytimeStatement(base({
      stoppages: [{ start: t('2026-06-01T00:00'), end: t('2026-06-02T00:00'), reason: 'all gear down' }],
    }));
    expect(proof.excludedHours).toBe(24);
    expect(proof.usedHours).toBe(36);
    expect(proof.result).toBe('on_despatch'); // 12 h saved at USD 12,000/day
    expect(proof.amountDue).toBeCloseTo(6000, 6);
  });

  it('rain inside a breakdown: the full stop governs those 2 h → 5.5 + 2 = 7.5 h excluded', () => {
    const proof = calculateLaytimeStatement(base({
      stoppages: [
        { start: t('2026-06-01T00:00'), end: t('2026-06-02T00:00'), reason: 'crane #2 breakdown', countFraction: 0.75 },
        { start: t('2026-06-01T10:00'), end: t('2026-06-01T12:00'), reason: 'rain' },
      ],
    }));
    expect(proof.excludedHours).toBeCloseTo(7.5, 9);
    expect(proof.usedHours).toBeCloseTo(52.5, 9);
    expect(proof.amountDue).toBeCloseTo(4500, 6);
    expect(proof.exclusions.map((e) => e.reason)).toEqual([
      'Stoppage — crane #2 breakdown (pro rata: 75% counts)',
      'Stoppage — rain',
      'Stoppage — crane #2 breakdown (pro rata: 75% counts)',
    ]);
  });

  it('once on demurrage, a breakdown that does not stop demurrage counts in full (CHRT-007)', () => {
    const proof = calculateLaytimeStatement(base({
      allowedHours: 24,
      completedAt: t('2026-06-02T12:00'), // 36 h gross, on demurrage from 06-02 00:00
      stoppages: [{ start: t('2026-06-02T00:00'), end: t('2026-06-02T12:00'), reason: 'crane #3 breakdown', countFraction: 0.5 }],
    }));
    expect(proof.excludedHours).toBe(0);
    expect(proof.usedHours).toBe(36);
    expect(proof.amountDue).toBeCloseTo(12000, 6);
    expect(proof.derivation.some((d) => d.rule === 'CHRT-007' && d.detail.includes('crane #3'))).toBe(true);
  });

  it('a breakdown that also stops demurrage (appliesOnDemurrage) is pro-rated on demurrage too', () => {
    const proof = calculateLaytimeStatement(base({
      allowedHours: 24,
      completedAt: t('2026-06-02T12:00'),
      stoppages: [{ start: t('2026-06-02T00:00'), end: t('2026-06-02T12:00'), reason: 'crane #3 breakdown', countFraction: 0.5, appliesOnDemurrage: true }],
    }));
    expect(proof.excludedHours).toBeCloseTo(6, 9);
    expect(proof.usedHours).toBeCloseTo(30, 9);
    expect(proof.amountDue).toBeCloseTo(6000, 6);
  });

  it.each([1, -0.1, 1.5, Number.NaN])('countFraction %s is refused (NULL, CHRT-008)', (f) => {
    const proof = calculateLaytimeStatement(base({
      stoppages: [{ start: t('2026-06-01T00:00'), end: t('2026-06-02T00:00'), reason: 'crane', countFraction: f, sourceRef: 'SOF p2' }],
    }));
    expect(proof.result).toBe('NULL');
    expect(proof.amountDue).toBeNull();
    expect(proof.nulls[0].missingField).toContain('pro-rata');
    expect(proof.nulls[0].sourceRef).toBe('SOF p2');
  });
});
