// Laytime trace: the per-figure ledger behind one laytime statement, as checkable lines.
//
// @rule:CHRT-006 — every figure carries its derivation. The engine's trace (calculateLaytimeStatement with trace:true)
// records each stretch of time: counted or excluded, under which clause and SOF line, which stoppage governed an overlap,
// which exception was refused on demurrage. This file (1) checks that the trace adds up to the statement, and
// (2) writes it out as a ledger a person can audit line by line. It computes nothing new.

import type { LaytimeProof, TraceSegment } from './statement.js';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const h = (min: number) => r3(min / 60);

/** The trace must reproduce the statement's own totals, minute for minute. Returns the problems (empty = it adds up). */
export function checkTrace(p: LaytimeProof): string[] {
  const t = p.trace;
  if (!t) return ['no trace on this statement (run it with trace: true)'];
  const sum = (f: (s: TraceSegment) => number) => t.segments.reduce((a, s) => a + f(s), 0);
  const problems: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (!near(sum((s) => s.minutes), t.totals.grossMinutes)) problems.push(`segments cover ${sum((s) => s.minutes)} min, gross is ${t.totals.grossMinutes}`);
  if (!near(sum((s) => s.countedMinutes), t.totals.countedMinutes)) problems.push(`segments count ${sum((s) => s.countedMinutes)} min, the statement ${t.totals.countedMinutes}`);
  if (!near(sum((s) => s.excludedMinutes), t.totals.excludedMinutes)) problems.push(`segments exclude ${sum((s) => s.excludedMinutes)} min, the statement ${t.totals.excludedMinutes}`);
  if (!near(t.totals.countedMinutes / 60, p.usedHours)) problems.push(`counted ${t.totals.countedMinutes / 60} h, used ${p.usedHours} h`);
  for (let i = 1; i < t.segments.length; i++) if (t.segments[i].from.getTime() !== t.segments[i - 1].to.getTime()) problems.push(`gap or overlap at segment ${i}`);
  if (t.money.unrounded != null && p.amountDue != null && !near(t.money.unrounded, p.amountDue)) problems.push('money in the trace differs from the statement');
  return problems;
}

/** The ledger as lines. `at` formats a Date for the reader (e.g. port local time); default ISO minutes. */
export function formatTrace(p: LaytimeProof, at: (d: Date) => string = (d) => d.toISOString().slice(0, 16).replace('T', ' ')): string[] {
  const t = p.trace;
  if (!t) return ['(no trace)'];
  const lines: string[] = [];
  lines.push(`Laytime commences ${at(t.commencement.at)}${t.commencement.ref ? ` — ${t.commencement.ref}` : ''}`);
  for (const s of t.segments) {
    const span = `${at(s.from)} → ${at(s.to)}  ${h(s.minutes).toFixed(3)} h`;
    const where = (x: { sourceRef?: string; clause?: string }) => [x.clause, x.sourceRef].filter(Boolean).join(' · ');
    let what: string;
    if (s.governing && s.governing.countFraction > 0) what = `PART COUNTS ${h(s.countedMinutes).toFixed(3)} h, excluded ${h(s.excludedMinutes).toFixed(3)} h — ${s.governing.reason}${where(s.governing) ? ` [${where(s.governing)}]` : ''}`;
    else if (s.governing) what = `EXCLUDED — ${s.governing.reason}${where(s.governing) ? ` [${where(s.governing)}]` : ''}`;
    else what = s.workedExceptedDay ? `COUNTS — excepted day, worked [${s.workedExceptedDay}]` : `COUNTS${s.onDemurrage ? ' (on demurrage)' : ''}`;
    lines.push(`  ${span}  ${what}`);
    for (const o of s.overridden) lines.push(`      overlap: ${o.reason}${where(o) ? ` [${where(o)}]` : ''} — not deducted again; the exception that stops more time governs`);
    for (const o of s.refusedOnDemurrage) lines.push(`      on demurrage: ${o.reason}${where(o) ? ` [${where(o)}]` : ''} — no longer applies, time counts`);
  }
  if (t.demurrageFrom) lines.push(`On demurrage from ${at(t.demurrageFrom)}`);
  lines.push(`Completed ${at(t.completion)}`);
  lines.push(`Gross ${h(t.totals.grossMinutes).toFixed(3)} h − excluded ${h(t.totals.excludedMinutes).toFixed(3)} h = used ${h(t.totals.countedMinutes).toFixed(3)} h; allowed ${h(t.totals.allowedMinutes).toFixed(3)} h; ${t.totals.overMinutes >= 0 ? 'over' : 'under'} ${h(Math.abs(t.totals.overMinutes)).toFixed(3)} h`);
  // Printed to six decimals with trailing zeros dropped: enough to show the amount is not rounded, without binary float noise.
  const money = (x: number | null) => (x == null ? 'not computed' : String(+x.toFixed(6)));
  lines.push(t.money.basis === 'none' ? 'Nothing due'
    : `${t.money.basis[0].toUpperCase()}${t.money.basis.slice(1)}: ${t.money.formula} = ${money(t.money.unrounded)} ${p.currency} (unrounded)`);
  lines.push(`Rounding: ${t.money.rounding}`);
  return lines;
}
