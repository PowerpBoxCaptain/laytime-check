#!/usr/bin/env node
// laytime-check — a laytime statement you can follow line by line: time allowed, time used, demurrage or despatch.
//
// Every figure is COMPUTE (worked from the inputs, with the working shown) or NULL (an input that decides it is
// missing, and which one). Nothing is assumed: no default demurrage rate, no default despatch rate ("half
// demurrage" is common, but only the charter party can say so), no guessed commencement.
//
// What it does: allowed time from quantity and rate (or given hours) · commencement from NOR + turn time, the
// GENCON 1994 cl.6(c) noon rule, or a time you state · SHINC / SHEX / SSHEX / FHEX, holidays, your own weekly
// excepted windows, "unless used" · stoppages that stop the clock fully or count pro rata (e.g. 3 of 4 cranes
// working = 0.75) · once on demurrage, always on demurrage, except stoppages the charter party also excepts from
// demurrage · demurrage and despatch, despatch on laytime saved or all time saved.
// What it does not do: decide whether a NOR was valid, whether a stoppage is excepted, or which reading of a clause
// is right. Those are questions for the charter party and the people who sign the statement.
//
// Times are port local, written "YYYY-MM-DDTHH:MM" with no offset.
// Usage: node laytime.mjs voyage.json [--json] [--sheet]      (--sheet prints the full time sheet)
// Exit codes: 0 complete statement · 2 statement with a NULL (an input is missing) · 3 the input is unreadable or invalid.
// License: AGPL-3.0-only.

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json'), SHEET = argv.includes('--sheet');
const file = argv.find((a) => !a.startsWith('--'));
const fail = (m) => { console.error(`laytime-check: invalid input: ${m}`); process.exit(3); };

let v;
try { v = JSON.parse(readFileSync(file ?? 0, 'utf8')); } catch (e) { fail(e.message); }

const MIN = 60e3, DAY_MIN = 1440;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function t(s, what) {
  if (s == null) return null;
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) fail(`${what}: "${s}" is not YYYY-MM-DDTHH:MM (port local, no offset)`);
  const ms = Date.parse(s + ':00Z'); if (Number.isNaN(ms)) fail(`${what}: "${s}" is not a real time`);
  return ms / MIN;                                            // minutes since epoch, port local treated as UTC
}
const show = (m) => new Date(m * MIN).toISOString().slice(0, 16).replace('T', ' ') + ` ${DAYS[new Date(m * MIN).getUTCDay()]}`;
const dur = (min) => { const r = Math.round(min); const d = Math.floor(r / DAY_MIN), h = Math.floor((r % DAY_MIN) / 60), m = r % 60; return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`; };
const hrs = (min) => +(min / 60).toFixed(4);
const money = (x) => Math.round(x * 100) / 100;

const steps = [], nulls = [];
const step = (what, detail) => steps.push({ what, detail });
const nul = (what, missing) => nulls.push({ what, missing });

// ---------- excepted time ----------
const TERMS = {
  SHINC: [],
  SHEX: [{ from: 'Sun 00:00', to: 'Mon 00:00' }],
  SSHEX: [{ from: 'Sat 00:00', to: 'Mon 00:00' }],
  FHEX: [{ from: 'Fri 00:00', to: 'Sat 00:00' }],
};
const terms = String(v.terms || '').toUpperCase();
if (!(terms in TERMS) && !v.excepted_weekly) fail(`terms must be one of ${Object.keys(TERMS).join(', ')} (or give excepted_weekly)`);
const weekly = (v.excepted_weekly || TERMS[terms]).map((w) => {
  const p = (s) => { const m = String(s).match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{2}):(\d{2})$/); if (!m) fail(`excepted_weekly: "${s}" is not like "Sat 12:00"`); return DAYS.indexOf(m[1]) * DAY_MIN + Number(m[2]) * 60 + Number(m[3]); };
  return [p(w.from), p(w.to)];
});
const holidayDays = new Set((v.holidays || []).map((d) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`holiday "${d}" is not YYYY-MM-DD`); return d; }));
const exceptsHolidays = terms !== 'SHINC' || v.holidays_excepted === true;
const unlessUsed = v.unless_used === true;
const used = (v.used || []).map((u) => [t(u.from, 'used.from'), t(u.to, 'used.to')]);

function excepted(m) {                                          // is minute m excepted by the day terms?
  const d = new Date(m * MIN); const wk = d.getUTCDay() * DAY_MIN + d.getUTCHours() * 60 + d.getUTCMinutes();
  const inWeekly = weekly.some(([a, b]) => (a <= b ? wk >= a && wk < b : wk >= a || wk < b));
  const holiday = exceptsHolidays && holidayDays.has(d.toISOString().slice(0, 10));
  if (!inWeekly && !holiday) return null;
  if (unlessUsed && used.some(([a, b]) => m >= a && m < b)) return null;   // worked on an excepted day: counts
  return holiday ? 'holiday' : `${terms || 'weekly'} excepted`;
}
function nextWorkingAt(m, hh, mm) {                            // hh:mm on the next day that is not excepted at that time
  let day = Math.floor(m / DAY_MIN) + 1;
  for (let i = 0; i < 14; i++, day++) { const at = day * DAY_MIN + hh * 60 + mm; if (!excepted(at)) return at; }
  return null;
}

// ---------- allowed time ----------
let allowedMin = null;
if (v.allowed_hours != null) { allowedMin = Number(v.allowed_hours) * 60; step('time allowed', `${v.allowed_hours} hours, as stated`); }
else if (v.quantity != null && v.rate_per_day != null) {
  if (!(v.quantity > 0 && v.rate_per_day > 0)) fail('quantity and rate_per_day must be positive');
  allowedMin = (v.quantity / v.rate_per_day) * DAY_MIN;
  step('time allowed', `${v.quantity} / ${v.rate_per_day} per day = ${+(v.quantity / v.rate_per_day).toFixed(6)} days = ${dur(allowedMin)} (${hrs(allowedMin)} h)`);
} else nul('time allowed', v.quantity == null ? 'quantity (or allowed_hours)' : 'rate_per_day (or allowed_hours)');

// ---------- commencement ----------
let start = t(v.laytime_commenced, 'laytime_commenced');
const nor = t(v.nor_tendered, 'nor_tendered');
if (start != null) step('laytime commenced', `${show(start)}, as stated${v.commencement_note ? ` (${v.commencement_note})` : ''}`);
else if (nor != null && v.commencement?.rule === 'turn_time') {
  start = nor + Number(v.commencement.hours) * 60;
  step('laytime commenced', `NOR ${show(nor)} + turn time ${v.commencement.hours} h = ${show(start)}`);
} else if (nor != null && v.commencement?.rule === 'gencon_noon') {
  const tod = nor % DAY_MIN;
  start = tod <= 720 ? nor - tod + 780 : nextWorkingAt(nor, 6, 0);
  if (start == null) nul('laytime commenced', 'a working day within 14 days of NOR');
  else step('laytime commenced', `NOR ${show(nor)} ${tod <= 720 ? 'up to and including 12:00: 13:00 the same day' : 'after 12:00: 06:00 next working day'} = ${show(start)} (GENCON 1994 cl.6(c))`);
} else nul('laytime commenced', nor == null ? 'nor_tendered (or laytime_commenced)' : 'commencement.rule (turn_time with hours, or gencon_noon)');
const end = t(v.completed, 'completed');
if (end == null) nul('time used', 'completed');
if (start != null && end != null && end < start) fail('completed is before laytime commenced');
if (unlessUsed && !v.used) nul('time used', 'used (the periods worked on excepted days; [] if none): "unless used" needs them');

// ---------- stoppages ----------
const stops = (v.stoppages || []).map((s, i) => {
  if (s.to == null) { nul('time used', `stoppages[${i}].to (${s.reason || 'stoppage'} has no end)`); return null; }
  const f = s.count_fraction ?? 0;
  if (!(f >= 0 && f < 1)) fail(`stoppages[${i}].count_fraction must be in [0, 1)`);
  return { a: t(s.from, `stoppages[${i}].from`), b: t(s.to, `stoppages[${i}].to`), f, reason: s.reason || 'stoppage', onDem: s.on_demurrage === true };
}).filter(Boolean);
const oncedem = v.once_on_demurrage !== false;

// ---------- the count ----------
const sheet = []; let usedMin = 0, demMin = 0, demFrom = null;
function seg(from, to, w, why, phase) {                        // merge consecutive minutes with the same treatment
  const last = sheet[sheet.length - 1];
  if (last && last.to === from && last.w === w && last.why === why && last.phase === phase) last.to = to;
  else sheet.push({ from, to, w, why, phase });
}
const ready = allowedMin != null && start != null && end != null && !nulls.some((n) => n.what === 'time used');
if (ready) {
  for (let m = start; m < end; m++) {
    const onDem = usedMin >= allowedMin - 1e-9;
    const act = stops.filter((s) => m >= s.a && m < s.b && (!onDem || !oncedem || s.onDem));
    const st = act.length ? act.reduce((x, y) => (y.f < x.f ? y : x)) : null;
    const ex = onDem && oncedem ? null : excepted(m);
    let w = ex ? 0 : st ? st.f : 1; const why = ex || (st ? `${st.reason}${st.f ? ` (counts ${st.f})` : ''}` : 'counts');
    if (!onDem) {
      const room = allowedMin - usedMin;
      if (w > room) {                                          // laytime runs out inside this minute
        const part = room / w; usedMin = allowedMin; demFrom = m + part;
        seg(m, m + part, w, why, 'laytime');
        const after = act.filter((s) => !oncedem || s.onDem); const st2 = after.length ? after.reduce((x, y) => (y.f < x.f ? y : x)) : null;
        const w2 = st2 ? st2.f : (oncedem ? 1 : (excepted(m) ? 0 : 1));
        demMin += (1 - part) * w2; seg(m + part, m + 1, w2, st2 ? st2.reason : 'counts', 'demurrage'); continue;
      }
      usedMin += w; seg(m, m + 1, w, why, 'laytime');
      if (demFrom == null && usedMin >= allowedMin - 1e-9) { usedMin = allowedMin; demFrom = m + 1; }   // ran out on the boundary
    } else { demMin += w; seg(m, m + 1, w, why, 'demurrage'); }
  }
  step('time used', `${dur(Math.min(usedMin, allowedMin) + demMin)} counted between ${show(start)} and ${show(end)} (${dur(end - start)} elapsed)`);
}

// ---------- result ----------
const R = { outcome: 'NULL', time_allowed_hours: allowedMin == null ? null : hrs(allowedMin), time_used_hours: null, demurrage_hours: null, despatch_hours: null, amount: null, currency: v.currency || '' };
const cur = v.currency ? ` ${v.currency}` : '';
if (ready) {
  R.time_used_hours = hrs(Math.min(usedMin, allowedMin) + demMin);
  if (demMin > 1e-9) {
    R.outcome = 'on demurrage'; R.demurrage_hours = hrs(demMin);
    step('laytime expired', `${show(Math.floor(demFrom))}${demFrom % 1 ? ` + ${Math.round((demFrom % 1) * 60)} s` : ''}; time on demurrage ${dur(demMin)} = ${hrs(demMin)} h`);
    if (v.demurrage_rate_per_day == null) nul('demurrage amount', 'demurrage_rate_per_day');
    else { R.amount = money((demMin / DAY_MIN) * v.demurrage_rate_per_day); step('demurrage', `${+(demMin / DAY_MIN).toFixed(6)} days x ${v.demurrage_rate_per_day}${cur} per day = ${R.amount.toFixed(2)}${cur}, due to owners`); }
  } else if (usedMin < allowedMin - 1e-9) {
    const basis = v.despatch_basis || 'laytime_saved';
    let saved = allowedMin - usedMin;
    if (basis === 'all_time_saved') {                           // run the clock on from completion with day exceptions only
      let left = saved, m = end; while (left > 1e-9) { const w = excepted(m) ? 0 : 1; if (w > left) { m += left / w; left = 0; } else { left -= w; m += 1; } if (m - end > 60 * DAY_MIN) break; }
      step('laytime would have expired', `${show(Math.floor(m))}; all time saved from completion = ${dur(m - end)}`);
      saved = m - end;
    } else step('laytime saved', `${dur(allowedMin)} allowed - ${dur(usedMin)} used = ${dur(saved)}`);
    R.outcome = 'on despatch'; R.despatch_hours = hrs(saved);
    if (v.despatch_rate_per_day == null) nul('despatch amount', 'despatch_rate_per_day (only the charter party says whether it is half demurrage, or none)');
    else { R.amount = money((saved / DAY_MIN) * v.despatch_rate_per_day); step('despatch', `${+(saved / DAY_MIN).toFixed(6)} days x ${v.despatch_rate_per_day}${cur} per day = ${R.amount.toFixed(2)}${cur}, due to charterers (${basis.replace(/_/g, ' ')})`); }
  } else { R.outcome = 'laytime exactly used'; R.amount = 0; step('result', 'laytime used exactly: no demurrage, no despatch'); }
}

const code = nulls.length ? 2 : 0;
if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ result: R, steps, nulls, sheet: sheet.map((s) => ({ from: show(s.from), to: show(s.to), minutes: +(s.to - s.from).toFixed(4), counts: s.w, why: s.why, phase: s.phase })) }, null, 2) + '\n');
  process.exit(code);
}
const out = [`LAYTIME STATEMENT${v.vessel ? `  ${v.vessel}` : ''}${v.port ? `  ${v.port}` : ''}  (${terms || 'custom'}${unlessUsed ? ' unless used' : ''}${oncedem ? ', once on demurrage always on demurrage' : ''})`];
steps.forEach((s, i) => out.push(`${String(i + 1).padStart(2)}. ${s.what}: ${s.detail}`));
if (SHEET && sheet.length) {
  out.push('', 'TIME SHEET (port local)');
  for (const s of sheet) out.push(`  ${show(s.from)}  to  ${show(s.to)}  ${dur(s.to - s.from).padStart(12)}  ${s.phase.padEnd(9)} x${String(+s.w.toFixed(4)).padEnd(6)} ${s.why}`);
}
out.push('', `RESULT: ${R.outcome.toUpperCase()}${R.amount != null && R.amount !== 0 ? `  ${R.amount.toFixed(2)}${cur}` : ''}`);
for (const n of nulls) out.push(`NULL  ${n.what}: missing ${n.missing}`);
out.push('Worked from the inputs given. Whether the NOR was valid and which stoppages the charter party excepts are for the parties to decide.');
process.stdout.write(out.join('\n') + '\n');
process.exit(code);
