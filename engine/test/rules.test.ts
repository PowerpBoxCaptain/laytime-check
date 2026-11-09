/** rules.ts: a missing rate gives a NULL amount, never 0 (CHRT-008). */
import { describe, it, expect } from 'vitest';
import { calculateLaytimeResult, calculateReversibleLaytime } from '../src/rules.js';

describe('calculateLaytimeResult', () => {
  it('demurrage with a rate: 12 h over at 20,000/day = 10,000', () => {
    expect(calculateLaytimeResult({ allowedHours: 72, grossHours: 84, excludedHours: 0, demurrageRate: 20000, despatchRate: null }).amountDue).toBeCloseTo(10000, 9);
  });
  it('demurrage, no demurrage rate → amount NULL, result still on demurrage', () => {
    const r = calculateLaytimeResult({ allowedHours: 72, grossHours: 84, excludedHours: 0, demurrageRate: null, despatchRate: 10000 });
    expect(r.result).toBe('on_demurrage');
    expect(r.amountDue).toBeNull();
  });
  it('despatch, no despatch rate → amount NULL (never assumed half demurrage)', () => {
    const r = calculateLaytimeResult({ allowedHours: 72, grossHours: 60, excludedHours: 0, demurrageRate: 20000, despatchRate: null });
    expect(r.result).toBe('on_despatch');
    expect(r.amountDue).toBeNull();
  });
  it('within laytime → 0 whatever the rates', () => {
    expect(calculateLaytimeResult({ allowedHours: 72, grossHours: 72, excludedHours: 0, demurrageRate: null, despatchRate: null }).amountDue).toBe(0);
  });
});

describe('calculateReversibleLaytime', () => {
  it('no rate on any port for the side that applies → NULL', () => {
    expect(calculateReversibleLaytime([{ allowedHours: 24, usedHours: 30, demurrageRate: null, despatchRate: 5000 }]).amountDue).toBeNull();
  });
  it('a rate on any port is used', () => {
    expect(calculateReversibleLaytime([{ allowedHours: 24, usedHours: 30, demurrageRate: null, despatchRate: null }, { allowedHours: 24, usedHours: 24, demurrageRate: 24000, despatchRate: null }]).amountDue).toBeCloseTo(6000, 9);
  });
});
