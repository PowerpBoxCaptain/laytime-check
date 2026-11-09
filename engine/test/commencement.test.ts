/**
 * Unit Tests: laytime commencement by charter terms (laytime-commencement.ts).
 * Every expected time worked by hand first. March 2026: Thu 05, Fri 06, Sat 07, Sun 08, Mon 09.
 */
import { describe, it, expect } from 'vitest';
import { commencementByTerms, type CommencementTerms } from '../src/commencement.js';

const officeMonFri = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
const noonSplit = { kind: 'noon_split' as const, noon: '12:00', sameDayAt: '13:00', nextWorkingDayAt: '06:00' };
const terms = (extra: Partial<CommencementTerms> = {}): CommencementTerms => ({
  norTendered: new Date('2026-03-05T23:15:00Z'), exceptionRule: 'shinc', officeHours: officeMonFri, rule: noonSplit, ...extra,
});
const at = (r: ReturnType<typeof commencementByTerms>) => r.commencedAt?.toISOString() ?? null;

describe('commencementByTerms', () => {
  it('NOR Thu 23:15, outside office hours → deemed Fri 09:00, before noon → laytime Fri 13:00', () => {
    const r = commencementByTerms(terms());
    expect(at(r)).toBe('2026-03-06T13:00:00.000Z');
    expect(r.derivation.some((d) => d.detail.includes('deemed') && d.detail.includes('2026-03-06T09:00'))).toBe(true);
  });

  it('NOR at exactly 12:00 counts as before noon ("up to and including") → 13:00 same day', () => {
    expect(at(commencementByTerms(terms({ norTendered: new Date('2026-03-05T12:00:00Z') })))).toBe('2026-03-05T13:00:00.000Z');
  });

  it('NOR Thu 12:01 → 06:00 next working day, Fri', () => {
    expect(at(commencementByTerms(terms({ norTendered: new Date('2026-03-05T12:01:00Z') })))).toBe('2026-03-06T06:00:00.000Z');
  });

  it('SHEX: NOR Sat 11:00 with office hours Mon–Sat → before noon → Sat 13:00', () => {
    const r = commencementByTerms(terms({ norTendered: new Date('2026-03-07T11:00:00Z'), exceptionRule: 'shex', officeHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' } }));
    expect(at(r)).toBe('2026-03-07T13:00:00.000Z');
  });

  it('SHEX: NOR Sat 14:00 (office Mon–Sat) → after noon → next working day skips Sunday → Mon 06:00', () => {
    const r = commencementByTerms(terms({ norTendered: new Date('2026-03-07T14:00:00Z'), exceptionRule: 'shex', officeHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' } }));
    expect(at(r)).toBe('2026-03-09T06:00:00.000Z');
  });

  it('office hours skip a port holiday: NOR Thu 23:15, Fri 06 Mar a holiday → deemed Mon 09:00 → Mon 13:00', () => {
    const r = commencementByTerms(terms({ holidays: [{ date: new Date('2026-03-06T00:00:00Z'), affectsLaytime: true }] }));
    expect(at(r)).toBe('2026-03-09T13:00:00.000Z');
  });

  it('no office-hours term → NOR counts when given: Thu 23:15 is after noon → Fri 06:00', () => {
    expect(at(commencementByTerms(terms({ officeHours: undefined })))).toBe('2026-03-06T06:00:00.000Z');
  });

  it("on the port's clock (Asia/Kolkata): NOR Thu 23:15 IST (17:45Z) → Fri 13:00 IST (07:30Z)", () => {
    const r = commencementByTerms(terms({ norTendered: new Date('2026-03-05T17:45:00Z'), portTimeZone: 'Asia/Kolkata' }));
    expect(at(r)).toBe('2026-03-06T07:30:00.000Z');
  });

  it('notice hours: NOR Mon 08:30 + 6 h → Mon 14:30, as the old helper', () => {
    const r = commencementByTerms({ norTendered: new Date('2026-03-02T08:30:00Z'), exceptionRule: 'shinc', rule: { kind: 'notice_hours', hours: 6 } });
    expect(at(r)).toBe('2026-03-02T14:30:00.000Z');
  });

  it('notice hours run from the deemed time when NOR is outside office hours: Thu 23:15 → Fri 09:00 + 6 h = 15:00', () => {
    const r = commencementByTerms(terms({ rule: { kind: 'notice_hours', hours: 6 } }));
    expect(at(r)).toBe('2026-03-06T15:00:00.000Z');
  });

  it('an unknown time zone → NULL (CHRT-008)', () => {
    const r = commencementByTerms(terms({ portTimeZone: 'Asia/Atlantis' }));
    expect(r.commencedAt).toBeNull();
    expect(r.nulls.some((n) => n.missingField.includes('time zone'))).toBe(true);
  });

  it('malformed office hours → NULL (CHRT-008)', () => {
    const r = commencementByTerms(terms({ officeHours: { days: [1], start: '9am', end: '17:00' } }));
    expect(r.commencedAt).toBeNull();
    expect(r.nulls.some((n) => n.missingField.includes('office hours'))).toBe(true);
  });

  it('it never says the NOR was valid: the derivation states validity is not checked', () => {
    expect(commencementByTerms(terms()).derivation.some((d) => d.detail.includes('NOT checked'))).toBe(true);
  });
});
