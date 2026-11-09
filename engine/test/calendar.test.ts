/**
 * Ported from the public clean-room calculator's hand-worked cases (9 Nov 2026): exact expiry inside a minute,
 * SSHEX, own weekly excepted windows, and the noon rule's next working day under them. 1 June 2026 is a Monday.
 */
import { describe, it, expect } from 'vitest';
import { calculateLaytimeStatement } from '../src/statement.js';
import { commencementByTerms } from '../src/commencement.js';

const T = (s: string) => new Date(`2026-06-${s}:00Z`);
const base = { demurrageRate: 20000, despatchRate: 10000, currency: 'USD' };

describe('exact expiry inside a minute', () => {
  it('1.01 h allowed, everything at 0.75: expires after 80.8 real minutes; to 02:00 = 39.2 min on demurrage = USD 544.44', () => {
    const p = calculateLaytimeStatement({ ...base, commencedAt: T('01T00:00'), completedAt: T('01T02:00'), allowedHours: 1.01, exceptionRule: 'shinc',
      stoppages: [{ start: T('01T00:00'), end: T('01T03:00'), reason: 'one hatch idle', countFraction: 0.75 }] });
    expect(p.usedHours - 1.01).toBeCloseTo(39.2 / 60, 9);
    expect(p.amountDue!).toBeCloseTo(544.444444, 5);
    expect(p.demurrageCommencedAt?.getTime()).toBe(T('01T01:20').getTime() + 48_000); // 01:20:48
  });
});

describe('SSHEX and weekly windows', () => {
  it('SSHEX: Fri 00:00 to Tue 00:00 = 96 h, Saturday and Sunday out = 48 h used', () => {
    const p = calculateLaytimeStatement({ ...base, commencedAt: T('05T00:00'), completedAt: T('09T00:00'), allowedHours: 48, exceptionRule: 'sshex' });
    expect(p.usedHours).toBeCloseTo(48, 9);
  });
  it('own window Sat 12:00 to Mon 08:00 (44 h): Fri 00:00 to Tue 00:00 = 96 − 44 = 52 h; 48 allowed → 4 h demurrage', () => {
    const p = calculateLaytimeStatement({ ...base, commencedAt: T('05T00:00'), completedAt: T('09T00:00'), allowedHours: 48, exceptionRule: 'shinc',
      exceptedWeekly: [{ from: 'Sat 12:00', to: 'Mon 08:00' }] });
    expect(p.usedHours).toBeCloseTo(52, 9);
    expect(p.amountDue!).toBeCloseTo((4 / 24) * 20000, 6);
  });
  it('a malformed window is NULL, not ignored', () => {
    const p = calculateLaytimeStatement({ ...base, commencedAt: T('05T00:00'), completedAt: T('09T00:00'), allowedHours: 48, exceptionRule: 'shinc',
      exceptedWeekly: [{ from: 'Saturday noon', to: 'Mon 08:00' }] });
    expect(p.result).toBe('NULL');
  });
  it('the window is read on the port clock (Asia/Kolkata, +05:30)', () => {
    // Sat 12:00 IST = Sat 06:30Z. Window Sat 12:00 → Sat 18:00 IST = 06:30Z → 12:30Z: 6 h out of Sat 00:00Z → Sun 00:00Z.
    const p = calculateLaytimeStatement({ ...base, commencedAt: T('06T00:00'), completedAt: T('07T00:00'), allowedHours: 100, exceptionRule: 'shinc',
      portTimeZone: 'Asia/Kolkata', exceptedWeekly: [{ from: 'Sat 12:00', to: 'Sat 18:00' }] });
    expect(p.usedHours).toBeCloseTo(18, 9);
  });
});

describe('noon rule: next working day', () => {
  const noon = { kind: 'noon_split' as const, noon: '12:00', sameDayAt: '13:00', nextWorkingDayAt: '06:00' };
  it('NOR Fri 14:00 under SHEX → Saturday 06:00', () => {
    expect(commencementByTerms({ norTendered: T('05T14:00'), exceptionRule: 'shex', rule: noon }).commencedAt?.toISOString()).toBe('2026-06-06T06:00:00.000Z');
  });
  it('NOR Fri 14:00 under SSHEX → Monday 06:00', () => {
    expect(commencementByTerms({ norTendered: T('05T14:00'), exceptionRule: 'sshex', rule: noon }).commencedAt?.toISOString()).toBe('2026-06-08T06:00:00.000Z');
  });
  it('own window Sat 00:00 to Mon 08:00: Monday 06:00 is inside it → Tuesday 06:00', () => {
    expect(commencementByTerms({ norTendered: T('05T14:00'), exceptionRule: 'shinc', exceptedWeekly: [{ from: 'Sat 00:00', to: 'Mon 08:00' }], rule: noon })
      .commencedAt?.toISOString()).toBe('2026-06-09T06:00:00.000Z');
  });
});
