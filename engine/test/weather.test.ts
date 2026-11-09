/**
 * Unit tests: weather wordings (laytime-weather.ts) through the statement engine.
 * Port works 08:00-16:00 (8 h). SHINC, so only weather moves the clock. Laytime 5 days (120 h) from Mon 00:00.
 */
import { describe, it, expect } from 'vitest';
import { weatherStoppages, workingTimeStoppages } from '../src/weather.js';
import { calculateLaytimeStatement } from '../src/statement.js';

const t = (s: string) => new Date(`2026-03-${s}:00Z`);
const WH: [string, string][] = [['08:00', '16:00']];
const WORKING_DAY: [string, string][] = [['07:00', '19:00']];
const excluded = (stoppages: ReturnType<typeof weatherStoppages>) => calculateLaytimeStatement({
  commencedAt: t('02T00:00'), completedAt: t('07T00:00'), allowedHours: 120, exceptionRule: 'shinc', stoppages,
  demurrageRate: 24000, despatchRate: 12000,
}).excludedHours;

describe('weatherStoppages', () => {
  it('ratio: 2 of 8 working hours lost → a quarter of the 24 h day (6 h) excluded', () => {
    const s = weatherStoppages([{ start: t('02T10:00'), end: t('02T12:00') }], 'ratio', WH);
    expect(s).toHaveLength(1);
    expect(s[0].countFraction).toBeCloseTo(0.75, 9);
    expect(excluded(s)).toBeCloseTo(6, 9);
  });

  it('actual: the same rain excludes only its own 2 h', () => {
    expect(excluded(weatherStoppages([{ start: t('02T10:00'), end: t('02T12:00') }], 'actual'))).toBeCloseTo(2, 9);
  });

  it('ratio: rain outside working hours excludes nothing; actual still excludes it', () => {
    const w = [{ start: t('02T18:00'), end: t('02T20:00') }];
    expect(weatherStoppages(w, 'ratio', WH)).toEqual([]);
    expect(excluded(weatherStoppages(w, 'actual'))).toBeCloseTo(2, 9);
  });

  it('ratio: only the overlap with working hours counts (15:00-17:00 → 1 h of 8 → 3 h)', () => {
    expect(excluded(weatherStoppages([{ start: t('02T15:00'), end: t('02T17:00') }], 'ratio', WH))).toBeCloseTo(3, 9);
  });

  it('ratio: all working hours lost → the whole day is a full stop (24 h)', () => {
    const s = weatherStoppages([{ start: t('03T06:00'), end: t('03T18:00') }], 'ratio', WH);
    expect(s[0].countFraction).toBeUndefined();
    expect(excluded(s)).toBeCloseTo(24, 9);
  });

  it('ratio: an interruption across midnight is split by day; two showers on one day add up', () => {
    const s = weatherStoppages([
      { start: t('03T15:00'), end: t('04T09:00') },   // day 3: 1 h, day 4: 1 h
      { start: t('04T12:00'), end: t('04T14:00') },   // day 4: +2 h → 3 h
    ], 'ratio', WH);
    expect(s.map((x) => x.start.toISOString().slice(0, 10))).toEqual(['2026-03-03', '2026-03-04']);
    expect(excluded(s)).toBeCloseTo(3 + 9, 9); // 1/8 × 24 + 3/8 × 24
  });

  it('ratio at a 24-hour port equals the actual method', () => {
    const w = [{ start: t('02T10:00'), end: t('02T12:30') }];
    expect(excluded(weatherStoppages(w, 'ratio', [['00:00', '24:00']]))).toBeCloseTo(excluded(weatherStoppages(w, 'actual')), 9);
  });

  it('once on demurrage, weather stops nothing (laytime-only exception)', () => {
    const p = calculateLaytimeStatement({
      commencedAt: t('02T00:00'), completedAt: t('04T00:00'), allowedHours: 24, exceptionRule: 'shinc',
      stoppages: weatherStoppages([{ start: t('03T10:00'), end: t('03T12:00') }], 'ratio', WH),
      demurrageRate: 24000, despatchRate: 12000,
    });
    expect(p.excludedHours).toBe(0);
  });

  it('def. 17: 24 working hours at a 07:00-19:00 port span two calendar days', () => {
    // Laytime 24 h from Mon 07:00; nothing else stops the clock. 12 working hours Mon + 12 Tue → laytime ends Tue 19:00.
    const p = calculateLaytimeStatement({ commencedAt: t('02T07:00'), completedAt: t('04T07:00'), allowedHours: 24, exceptionRule: 'shinc',
      stoppages: workingTimeStoppages(t('02T07:00'), t('04T07:00'), WORKING_DAY), demurrageRate: 24000, despatchRate: 12000 });
    expect(p.demurrageCommencedAt?.toISOString()).toBe('2026-03-03T19:00:00.000Z');
    expect(p.usedHours).toBeCloseTo(36, 9); // 24 working hours + 12 h on demurrage, Tue 19:00 → Wed 07:00, every hour counting
  });

  it('def. 17: rain inside working hours comes off as actual time; laytime ends 3 h later in working time', () => {
    const p = calculateLaytimeStatement({ commencedAt: t('02T07:00'), completedAt: t('05T07:00'), allowedHours: 24, exceptionRule: 'shinc',
      stoppages: [...workingTimeStoppages(t('02T07:00'), t('05T07:00'), WORKING_DAY), ...weatherStoppages([{ start: t('02T10:00'), end: t('02T13:00') }], 'actual')],
      demurrageRate: 24000, despatchRate: 12000 });
    expect(p.demurrageCommencedAt?.toISOString()).toBe('2026-03-04T10:00:00.000Z'); // Mon 9 + Tue 12 + Wed 3
  });

  it('def. 17: off-time is generated only inside the range and refuses without working hours', () => {
    const s = workingTimeStoppages(t('02T12:00'), t('03T09:00'), WORKING_DAY);
    expect(s.map((x) => [x.start.toISOString().slice(8, 16), x.end.toISOString().slice(8, 16)])).toEqual([['02T19:00', '03T07:00']]);
    expect(() => workingTimeStoppages(t('02T00:00'), t('03T00:00'), [])).toThrow(/working hours/);
  });

  it('ratio without working hours is refused', () => {
    expect(() => weatherStoppages([{ start: t('02T10:00'), end: t('02T12:00') }], 'ratio')).toThrow(/working hours/);
  });
});
