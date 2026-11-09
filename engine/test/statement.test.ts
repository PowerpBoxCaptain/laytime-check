/**
 * Unit Tests: Demurrage-aware Laytime Statement 
 *
 * Coverage in this file:
 *   AC1 — Fixture A "Sunday Trap": on_demurrage, $54,000, cites Sun 2026-06-14 (CHRT-007)
 *   ——  — Naïve (onceOnDemurrage:false) reproduces the wrapper's $36,000 error
 *   AC3 — Fixture B "The Refusal": NULL, names missing field, no number (CHRT-008)
 *   AC5 — every specialist figure is rule+source bound (no orphan numbers)
 *   AC6 — deterministic: identical output across runs
 *   INF-CHRT-002 — UU without used/idle log → NULL (CHRT-YK-001)
 *
 */

import { describe, it, expect } from 'vitest';
import {
  calculateLaytimeStatement,
  type LaytimeStatementInput,
} from '../src/statement.js';

// ─── Fixture A — "The Sunday Trap" ───────────────────────────────────────────
// SHEX, 5 days (120h) allowed, $18,000/day demurrage. Commences Sat 2026-06-06
// 00:00, completes Mon 2026-06-15 00:00 (216h gross). Sundays: 07 Jun (within
// laytime → excluded) and 14 Jun (on demurrage → counts).
const fixtureA = (onceOnDemurrage: boolean): LaytimeStatementInput => ({
  commencedAt: new Date('2026-06-06T00:00:00Z'),
  completedAt: new Date('2026-06-15T00:00:00Z'),
  allowedHours: 120,
  exceptionRule: 'shex',
  holidays: [],
  onceOnDemurrage,
  demurrageRate: 18000,
  despatchRate: 9000,
  currency: 'USD',
});

describe('Fixture A — Sunday Trap (CHRT-007 / INF-CHRT-001)', () => {
  it('AC1: specialist counts the post-demurrage Sunday → $54,000', () => {
    const proof = calculateLaytimeStatement(fixtureA(true));

    expect(proof.result).toBe('on_demurrage');
    expect(proof.amountDue).toBe(54000);
    expect(proof.excludedHours).toBe(24); // only Sun 07 Jun
    expect(proof.usedHours).toBe(192);
    expect(proof.demurrageCommencedAt?.toISOString()).toBe('2026-06-12T00:00:00.000Z');

    // derivation must explicitly cite the disputed Sunday under CHRT-007
    const citesSunday14 = proof.derivation.some(
      (d) => d.rule === 'CHRT-007' && d.detail.includes('2026-06-14'),
    );
    expect(citesSunday14).toBe(true);
  });

  it('reproduces the wrapper/naïve error when once-on-demurrage is OFF → $36,000', () => {
    const proof = calculateLaytimeStatement(fixtureA(false));
    expect(proof.result).toBe('on_demurrage');
    expect(proof.amountDue).toBe(36000); // both Sundays wrongly excluded
    expect(proof.excludedHours).toBe(48);
    expect(proof.usedHours).toBe(168);
  });

  it('AC5: no orphan numbers — every derivation step is rule-bound', () => {
    const proof = calculateLaytimeStatement(fixtureA(true));
    expect(proof.derivation.length).toBeGreaterThan(0);
    for (const d of proof.derivation) {
      expect(d.rule).toMatch(/^(CHRT-006|CHRT-007|INF-CHRT-001)$/);
      expect(d.detail.length).toBeGreaterThan(0);
    }
  });

  it('AC6: deterministic — identical output across runs', () => {
    const a = calculateLaytimeStatement(fixtureA(true));
    const b = calculateLaytimeStatement(fixtureA(true));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Fixture B — "The Refusal" ───────────────────────────────────────────────
describe('Fixture B — The Refusal (CHRT-008)', () => {
  it('AC3: returns NULL, names the missing facts, asserts no number', () => {
    const proof = calculateLaytimeStatement({
      commencedAt: new Date('2026-06-06T00:00:00Z'),
      completedAt: new Date('2026-06-15T00:00:00Z'),
      allowedHours: 120,
      exceptionRule: 'shex',
      demurrageRate: 18000,
      despatchRate: 9000,
      currency: 'USD',
      determinacy: {
        commencementUnderdetermined: { sourceRef: 'CP NOR clause', missingField: 'office hours' },
        unboundedStoppages: [{ sourceRef: 'SOF line 14 (rain)' }],
      },
    });

    expect(proof.result).toBe('NULL');
    expect(proof.amountDue).toBeNull();
    expect(proof.nulls).toHaveLength(2);
    expect(proof.nulls.every((n) => n.rule === 'CHRT-008')).toBe(true);
    expect(proof.nulls.map((n) => n.sourceRef)).toContain('SOF line 14 (rain)');
  });

  it('INF-CHRT-002: UU without a used/idle log → NULL', () => {
    const proof = calculateLaytimeStatement({
      commencedAt: new Date('2026-06-06T00:00:00Z'),
      completedAt: new Date('2026-06-15T00:00:00Z'),
      allowedHours: 120,
      exceptionRule: 'uu',
      demurrageRate: 18000,
      despatchRate: 9000,
      determinacy: { usedDataMissingForUU: true },
    });
    expect(proof.result).toBe('NULL');
    expect(proof.nulls.some((n) => n.missingField.includes('used/idle'))).toBe(true);
  });
});

// ─── SOF stoppages (added 18 Oct 2026) ───────────────────────────────────────
// Sample voyage, worked by hand first: SHEX, 120 h allowed, USD 15,000/day.
// Laytime Thu 2026-03-05 13:00 → completed Wed 2026-03-11 20:00 = 151 h gross.
// Rain Fri 14:00–18:00 (4 h) + Sunday 08 Mar (24 h) excluded → 123 h used →
// 3 h on demurrage from Wed 17:00 → USD 1,875.
const voyage = (extra: Partial<LaytimeStatementInput> = {}): LaytimeStatementInput => ({
  commencedAt: new Date('2026-03-05T13:00:00Z'),
  completedAt: new Date('2026-03-11T20:00:00Z'),
  allowedHours: 120,
  exceptionRule: 'shex',
  demurrageRate: 15000,
  despatchRate: 7500,
  currency: 'USD',
  stoppages: [{ start: new Date('2026-03-06T14:00:00Z'), end: new Date('2026-03-06T18:00:00Z'), reason: 'rain', sourceRef: 'SOF line 9' }],
  ...extra,
});

describe('SOF stoppages', () => {
  it('excludes a rain stoppage within laytime → USD 1,875 (hand answer)', () => {
    const proof = calculateLaytimeStatement(voyage());
    expect(proof.result).toBe('on_demurrage');
    expect(proof.usedHours).toBe(123);
    expect(proof.excludedHours).toBe(28);
    expect(proof.amountDue).toBe(1875);
    expect(proof.demurrageCommencedAt?.toISOString()).toBe('2026-03-11T17:00:00.000Z');
    expect(proof.exclusions.some((e) => e.reason === 'Stoppage — rain' && e.hours === 4)).toBe(true);
  });

  it('counts to the minute: rain 14:20–16:45 excludes 2 h 25 min', () => {
    const proof = calculateLaytimeStatement(voyage({
      stoppages: [{ start: new Date('2026-03-06T14:20:00Z'), end: new Date('2026-03-06T16:45:00Z'), reason: 'rain' }],
    }));
    expect(proof.excludedHours).toBeCloseTo(24 + 145 / 60, 9);
  });

  it('does not double-count a stoppage that falls on an excepted Sunday', () => {
    const proof = calculateLaytimeStatement(voyage({
      stoppages: [{ start: new Date('2026-03-08T10:00:00Z'), end: new Date('2026-03-08T12:00:00Z'), reason: 'rain' }],
    }));
    expect(proof.excludedHours).toBe(24);
  });

  it('once on demurrage, a rain stoppage counts and is named (CHRT-007)', () => {
    const proof = calculateLaytimeStatement(voyage({
      stoppages: [{ start: new Date('2026-03-11T18:00:00Z'), end: new Date('2026-03-11T19:00:00Z'), reason: 'rain', sourceRef: 'SOF line 22' }],
    }));
    expect(proof.usedHours).toBe(127);
    expect(proof.derivation.some((d) => d.rule === 'CHRT-007' && d.detail.includes('Stoppage — rain') && d.sourceRef === 'SOF line 22')).toBe(true);
  });

  it("a stoppage that also stops demurrage (ship's gear) is excluded on demurrage", () => {
    const proof = calculateLaytimeStatement(voyage({
      stoppages: [{ start: new Date('2026-03-11T18:00:00Z'), end: new Date('2026-03-11T19:00:00Z'), reason: "ship's crane breakdown", appliesOnDemurrage: true }],
    }));
    expect(proof.usedHours).toBe(126);
    expect(proof.amountDue).toBe(3750);
  });

  it('a stoppage that ends before it starts → NULL (CHRT-008)', () => {
    const proof = calculateLaytimeStatement(voyage({
      stoppages: [{ start: new Date('2026-03-06T18:00:00Z'), end: new Date('2026-03-06T14:00:00Z'), reason: 'rain', sourceRef: 'SOF line 9' }],
    }));
    expect(proof.result).toBe('NULL');
    expect(proof.amountDue).toBeNull();
    expect(proof.nulls.map((n) => n.sourceRef)).toContain('SOF line 9');
  });
});

// ─── SHEX unless used (added 27 Oct 2026) ────────────────
// Worked by hand first: 96 h allowed, USD 16,000/day, despatch USD 8,000/day on laytime saved.
// Laytime Thu 2026-03-05 08:00 → completed Mon 2026-03-09 20:00 = 108 h gross.
// Sunday 08 Mar worked 08:00–16:00. Unless used: 16 h excluded → 92 h used → 4 h saved → USD 1,333.33.
// Even if used: 24 h excluded → 84 h used → 12 h saved → USD 4,000.
const uuVoyage = (extra: Partial<LaytimeStatementInput> = {}): LaytimeStatementInput => ({
  commencedAt: new Date('2026-03-05T08:00:00Z'),
  completedAt: new Date('2026-03-09T20:00:00Z'),
  allowedHours: 96,
  exceptionRule: 'uu',
  demurrageRate: 16000,
  despatchRate: 8000,
  currency: 'USD',
  ...extra,
});
const sundayWorked = [{ start: new Date('2026-03-08T08:00:00Z'), end: new Date('2026-03-08T16:00:00Z'), sourceRef: 'SOF Sun 08 Mar overtime' }];

describe('SHEX unless used: hours worked on an excepted day', () => {
  it('UU with the hours worked on Sunday → 16 h excluded, despatch USD 1,333.33', () => {
    const proof = calculateLaytimeStatement(uuVoyage({ usedPeriods: sundayWorked }));
    expect(proof.result).toBe('on_despatch');
    expect(proof.excludedHours).toBe(16);
    expect(proof.usedHours).toBe(92);
    expect(proof.amountDue).toBeCloseTo(1333.33, 2);
    expect(proof.derivation.some((d) => d.detail.includes('worked') && d.sourceRef === 'SOF Sun 08 Mar overtime')).toBe(true);
  });

  it('UU with no used-periods input at all → NULL, without the caller having to set a flag', () => {
    const proof = calculateLaytimeStatement(uuVoyage());
    expect(proof.result).toBe('NULL');
    expect(proof.amountDue).toBeNull();
    expect(proof.nulls.some((n) => n.missingField.includes('used/idle'))).toBe(true);
  });

  it('UU with an empty list (nothing worked on excepted days) → same as even if used, USD 4,000', () => {
    const proof = calculateLaytimeStatement(uuVoyage({ usedPeriods: [] }));
    expect(proof.excludedHours).toBe(24);
    expect(proof.amountDue).toBe(4000);
  });

  it('EIU ignores the hours worked → USD 4,000', () => {
    const proof = calculateLaytimeStatement(uuVoyage({ exceptionRule: 'eiu', usedPeriods: sundayWorked }));
    expect(proof.excludedHours).toBe(24);
    expect(proof.amountDue).toBe(4000);
  });

  it('a worked period on an ordinary day changes nothing', () => {
    const proof = calculateLaytimeStatement(uuVoyage({ usedPeriods: [{ start: new Date('2026-03-06T08:00:00Z'), end: new Date('2026-03-06T16:00:00Z') }] }));
    expect(proof.excludedHours).toBe(24);
    expect(proof.amountDue).toBe(4000);
  });

  it('a worked period that ends before it starts → NULL (CHRT-008)', () => {
    const proof = calculateLaytimeStatement(uuVoyage({ usedPeriods: [{ start: new Date('2026-03-08T16:00:00Z'), end: new Date('2026-03-08T08:00:00Z'), sourceRef: 'SOF line 30' }] }));
    expect(proof.result).toBe('NULL');
    expect(proof.nulls.map((n) => n.sourceRef)).toContain('SOF line 30');
  });

  it('a rain stoppage inside a worked Sunday period is still excluded', () => {
    const proof = calculateLaytimeStatement(uuVoyage({
      usedPeriods: sundayWorked,
      stoppages: [{ start: new Date('2026-03-08T10:00:00Z'), end: new Date('2026-03-08T11:00:00Z'), reason: 'rain' }],
    }));
    expect(proof.excludedHours).toBe(17);
  });
});

// ─── Port local time (added 27 Oct 2026) ─────────────────
// Worked by hand first: Indian port (Asia/Kolkata, UTC+05:30), SHEX, 72 h, USD 12,000/day, despatch half.
// Laytime Thu 05 Mar 08:00 IST (02:30Z) → completed Sun 08 Mar 16:00 IST (10:30Z) = 80 h gross.
// Port's Sunday 00:00–16:00 IST = 16 h excluded → 64 h used → 8 h saved → USD 2,000.
// Counting UTC days instead excludes only 00:00Z–10:30Z (10.5 h) → USD 625.
const ist = (extra: Partial<LaytimeStatementInput> = {}): LaytimeStatementInput => ({
  commencedAt: new Date('2026-03-05T02:30:00Z'),
  completedAt: new Date('2026-03-08T10:30:00Z'),
  allowedHours: 72,
  exceptionRule: 'shex',
  demurrageRate: 12000,
  despatchRate: 6000,
  currency: 'USD',
  ...extra,
});

describe('port local time: excepted days on the port calendar', () => {
  it('Asia/Kolkata: the port Sunday is excluded → 16 h, despatch USD 2,000', () => {
    const proof = calculateLaytimeStatement(ist({ portTimeZone: 'Asia/Kolkata' }));
    expect(proof.excludedHours).toBe(16);
    expect(proof.amountDue).toBe(2000);
    expect(proof.exclusions[0].startTime.toISOString()).toBe('2026-03-07T18:30:00.000Z'); // Sun 00:00 IST
  });

  it('no portTimeZone → days are UTC days, as before (USD 625)', () => {
    const proof = calculateLaytimeStatement(ist());
    expect(proof.excludedHours).toBe(10.5);
    expect(proof.amountDue).toBe(625);
  });

  it('a port holiday is matched on the local date', () => {
    // Holiday Fri 06 Mar (stored date-only, UTC midnight). Local Friday 00:00 IST = Thu 18:30Z.
    const proof = calculateLaytimeStatement(ist({
      portTimeZone: 'Asia/Kolkata',
      holidays: [{ date: new Date('2026-03-06T00:00:00Z'), affectsLaytime: true }],
    }));
    expect(proof.excludedHours).toBe(40); // Friday 24 h + Sunday 16 h
  });

  it('a daylight-saving change is followed (Europe/London, clocks forward Sun 29 Mar 2026)', () => {
    // Sat 28 Mar 12:00 GMT → Mon 30 Mar 12:00 BST (11:00Z) = 47 h gross; London Sunday is 23 h long.
    const proof = calculateLaytimeStatement({
      commencedAt: new Date('2026-03-28T12:00:00Z'), completedAt: new Date('2026-03-30T11:00:00Z'),
      allowedHours: 100, exceptionRule: 'shex', demurrageRate: 12000, despatchRate: 6000, portTimeZone: 'Europe/London',
    });
    expect(proof.grossHours).toBe(47);
    expect(proof.excludedHours).toBe(23);
  });

  it('an unknown time zone → NULL (CHRT-008), no figure', () => {
    const proof = calculateLaytimeStatement(ist({ portTimeZone: 'Asia/Atlantis' }));
    expect(proof.result).toBe('NULL');
    expect(proof.nulls.some((n) => n.missingField.includes('time zone'))).toBe(true);
  });

  it('Friday-excepted port on its own calendar (Asia/Riyadh, UTC+03:00)', () => {
    // Wed 04 Mar 06:00 AST (03:00Z) → Sun 08 Mar 18:00 AST (15:00Z); FHEX, 72 h, USD 18,000/day → 9,000.
    const proof = calculateLaytimeStatement({
      commencedAt: new Date('2026-03-04T03:00:00Z'), completedAt: new Date('2026-03-08T15:00:00Z'),
      allowedHours: 72, exceptionRule: 'fhex', demurrageRate: 18000, despatchRate: 9000, portTimeZone: 'Asia/Riyadh',
    });
    expect(proof.excludedHours).toBe(24);
    expect(proof.amountDue).toBe(9000);
    expect(proof.demurrageCommencedAt?.toISOString()).toBe('2026-03-08T03:00:00.000Z');
  });
});

// ─── Despatch on all time saved (added 27 Oct 2026) ──────
// Worked by hand first: SHEX, 90 h allowed, despatch USD 7,500/day. Laytime Wed 04 Mar 08:00 → completed
// Fri 06 Mar 20:00 = 60 h used, 30 h of laytime left. Laytime saved: 30 h → USD 9,375. All time saved: run on
// from completion, the 30 h would have ended Mon 09 Mar 02:00 (Fri 20:00–Sat 24:00 28 h, Sunday excepted,
// Mon 00:00–02:00 2 h) = 54 h → USD 16,875.
const ats = (extra: Partial<LaytimeStatementInput> = {}): LaytimeStatementInput => ({
  commencedAt: new Date('2026-03-04T08:00:00Z'),
  completedAt: new Date('2026-03-06T20:00:00Z'),
  allowedHours: 90,
  exceptionRule: 'shex',
  demurrageRate: 15000,
  despatchRate: 7500,
  currency: 'USD',
  ...extra,
});

describe('despatch on all time saved', () => {
  it('default (laytime saved) is unchanged: USD 9,375', () => {
    expect(calculateLaytimeStatement(ats()).amountDue).toBe(9375);
  });

  it('all time saved counts the Sunday: 54 h → USD 16,875, expiry named', () => {
    const proof = calculateLaytimeStatement(ats({ despatchBasis: 'all_time_saved' }));
    expect(proof.result).toBe('on_despatch');
    expect(proof.amountDue).toBe(16875);
    expect(proof.usedHours).toBe(60);
    expect(proof.derivation.some((d) => d.detail.includes('2026-03-09T02:00') && d.detail.includes('54 h'))).toBe(true);
  });

  it('a holiday after completion also counts as saved: Mon 09 Mar holiday → 78 h → USD 24,375', () => {
    const proof = calculateLaytimeStatement(ats({
      despatchBasis: 'all_time_saved', holidays: [{ date: new Date('2026-03-09T00:00:00Z'), affectsLaytime: true }],
    }));
    expect(proof.amountDue).toBe(24375);
  });

  it("on the port's calendar (Asia/Kolkata): the same voyage in IST → USD 16,875", () => {
    const proof = calculateLaytimeStatement(ats({
      commencedAt: new Date('2026-03-04T02:30:00Z'), completedAt: new Date('2026-03-06T14:30:00Z'),
      portTimeZone: 'Asia/Kolkata', despatchBasis: 'all_time_saved',
    }));
    expect(proof.amountDue).toBe(16875);
  });

  it('on demurrage the basis changes nothing', () => {
    const proof = calculateLaytimeStatement(ats({ allowedHours: 48, despatchBasis: 'all_time_saved' }));
    expect(proof.result).toBe('on_demurrage');
    expect(proof.amountDue).toBe(7500);
  });

  it('an unknown basis → NULL (CHRT-008)', () => {
    const proof = calculateLaytimeStatement(ats({ despatchBasis: 'working_time' as never }));
    expect(proof.result).toBe('NULL');
    expect(proof.nulls.some((n) => n.missingField.includes('despatch basis'))).toBe(true);
  });
});
