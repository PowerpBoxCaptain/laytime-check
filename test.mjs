// Tests for laytime.mjs: `node test.mjs`. Every expected figure is worked by hand in the comment beside it.
// Calendar used: 1 June 2026 is a Monday.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CALC = fileURLToPath(new URL('./laytime.mjs', import.meta.url));
let fails = 0;
function run(name, voyage, want) {
  const r = spawnSync('node', [CALC, '--json'], { input: JSON.stringify(voyage), encoding: 'utf8' });
  let got = {}; try { got = JSON.parse(r.stdout); } catch {}
  const res = got.result || {};
  const errs = [];
  if ((want.exit ?? 0) !== r.status) errs.push(`exit ${r.status} (want ${want.exit ?? 0}) ${r.stderr.trim()}`);
  for (const [k, val] of Object.entries(want)) {
    if (k === 'exit') continue;
    if (k === 'nullMissing') { if (!(got.nulls || []).some((n) => n.missing.includes(val))) errs.push(`no NULL naming "${val}"`); continue; }
    if (k === 'stepHas') { if (!(got.steps || []).some((s) => s.detail.includes(val))) errs.push(`no step saying "${val}"`); continue; }
    if (typeof val === 'number' ? Math.abs((res[k] ?? NaN) - val) > 1e-3 : res[k] !== val) errs.push(`${k} = ${res[k]} (want ${val})`);
  }
  if (errs.length) fails++;
  console.log(`${errs.length ? 'FAIL' : 'PASS'}  ${name}${errs.length ? '\n      ' + errs.join('\n      ') : ''}`);
}
const base = { terms: 'SHINC', demurrage_rate_per_day: 20000, despatch_rate_per_day: 10000, currency: 'USD' };

// 30,000 t at 10,000/day = 3 days = 72 h. Mon 08:00 to Thu 20:00 = 84 h. Demurrage 12 h = 0.5 d x 20,000 = 10,000.
run('SHINC, quantity and rate, demurrage', { ...base, quantity: 30000, rate_per_day: 10000, laytime_commenced: '2026-06-01T08:00', completed: '2026-06-04T20:00' },
  { outcome: 'on demurrage', time_allowed_hours: 72, demurrage_hours: 12, amount: 10000 });
// SHEX: Fri 5 Jun 08:00 to Tue 9 Jun 12:00 = 100 h, Sunday 24 h out = 76 h counted; 72 allowed: 4 h demurrage x 24,000/24 = 4,000.
run('SHEX: Sunday excepted', { ...base, terms: 'SHEX', demurrage_rate_per_day: 24000, allowed_hours: 72, laytime_commenced: '2026-06-05T08:00', completed: '2026-06-09T12:00' },
  { outcome: 'on demurrage', demurrage_hours: 4, amount: 4000 });
// 24 h SHEX from Fri 08:00: expires Sat 08:00. To Mon 08:00 = 48 h on demurrage, Sunday included. 2 d x 10,000 = 20,000.
run('once on demurrage, always on demurrage (Sunday counts)', { ...base, terms: 'SHEX', demurrage_rate_per_day: 10000, allowed_hours: 24, laytime_commenced: '2026-06-05T08:00', completed: '2026-06-08T08:00' },
  { outcome: 'on demurrage', demurrage_hours: 48, amount: 20000 });
// Same with once_on_demurrage false: Sunday excepted on demurrage too: 24 h.
run('once_on_demurrage false: Sunday excepted on demurrage too', { ...base, terms: 'SHEX', demurrage_rate_per_day: 10000, allowed_hours: 24, once_on_demurrage: false, laytime_commenced: '2026-06-05T08:00', completed: '2026-06-08T08:00' },
  { demurrage_hours: 24, amount: 10000 });
// 48 h SHINC from Mon 00:00, rain Mon 06-12 (6 h out). To Wed 12:00 = 60 h - 6 = 54: 6 h demurrage.
run('full stoppage (rain)', { ...base, allowed_hours: 48, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-03T12:00', stoppages: [{ from: '2026-06-01T06:00', to: '2026-06-01T12:00', reason: 'rain' }] },
  { outcome: 'on demurrage', demurrage_hours: 6, amount: 5000 });
// 24 h allowed; Mon 00-12 at 0.5 (2 of 4 cranes) = 6 h, then 12 h full = 18 h used to Tue 00:00. Saved 6 h x 10,000/24 = 2,500.
run('pro-rata stoppage (cranes), despatch on laytime saved', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T00:00', stoppages: [{ from: '2026-06-01T00:00', to: '2026-06-01T12:00', reason: 'cranes 2 of 4', count_fraction: 0.5 }] },
  { outcome: 'on despatch', despatch_hours: 6, amount: 2500 });
// 60 h SHEX from Fri 00:00, completed Fri 12:00: 48 h laytime saved. All time saved: Fri 12:00 -> Sat 24:00 = 36 h,
// Sunday out, Mon 00-12 = 12 h: expires Mon 12:00 = 72 h after completion. 3 d x 10,000 = 30,000.
run('despatch on all time saved', { ...base, terms: 'SHEX', allowed_hours: 60, laytime_commenced: '2026-06-05T00:00', completed: '2026-06-05T12:00', despatch_basis: 'all_time_saved' },
  { outcome: 'on despatch', despatch_hours: 72, amount: 30000 });
run('despatch on laytime saved (same voyage)', { ...base, terms: 'SHEX', allowed_hours: 60, laytime_commenced: '2026-06-05T00:00', completed: '2026-06-05T12:00' },
  { despatch_hours: 48, amount: 20000 });
// 1.01 h = 60.6 min allowed, everything at 0.75: expires after 80.8 real min (00:00 + 80.8). To 02:00: 39.2 min = 0.65333 h on demurrage.
run('laytime runs out inside a minute (exact fraction)', { ...base, allowed_hours: 1.01, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-01T02:00', stoppages: [{ from: '2026-06-01T00:00', to: '2026-06-01T03:00', reason: 'one hatch idle', count_fraction: 0.75 }] },
  { demurrage_hours: 0.65333 });
// 24 h from Mon 00:00 expires Tue 00:00; to Wed 00:00 = 24 h, minus a gear breakdown Tue 06-12 the CP excepts from demurrage = 18 h.
run('stoppage that also counts against demurrage', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-03T00:00', stoppages: [{ from: '2026-06-02T06:00', to: '2026-06-02T12:00', reason: "ship's gear", on_demurrage: true }] },
  { demurrage_hours: 18 });
run('same stoppage NOT excepted on demurrage', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-03T00:00', stoppages: [{ from: '2026-06-02T06:00', to: '2026-06-02T12:00', reason: 'rain' }] },
  { demurrage_hours: 24 });
// GENCON 1994 cl.6(c): NOR Mon 11:30 -> 13:00 Mon. NOR Fri 14:00 SHEX -> 06:00 Sat; SSHEX -> 06:00 Mon.
run('noon rule: NOR before noon', { ...base, allowed_hours: 100, nor_tendered: '2026-06-01T11:30', commencement: { rule: 'gencon_noon' }, completed: '2026-06-01T14:00' }, { stepHas: '2026-06-01 13:00' });
run('noon rule: NOR exactly 12:00 counts as "up to and including"', { ...base, allowed_hours: 100, nor_tendered: '2026-06-01T12:00', commencement: { rule: 'gencon_noon' }, completed: '2026-06-01T14:00' }, { stepHas: '2026-06-01 13:00' });
run('noon rule: NOR after noon, SHEX -> Saturday 06:00', { ...base, terms: 'SHEX', allowed_hours: 100, nor_tendered: '2026-06-05T14:00', commencement: { rule: 'gencon_noon' }, completed: '2026-06-08T14:00' }, { stepHas: '2026-06-06 06:00' });
run('noon rule: NOR after noon, SSHEX -> Monday 06:00', { ...base, terms: 'SSHEX', allowed_hours: 100, nor_tendered: '2026-06-05T14:00', commencement: { rule: 'gencon_noon' }, completed: '2026-06-08T14:00' }, { stepHas: '2026-06-08 06:00' });
// NOR Mon 09:20 + 12 h turn time = Mon 21:20.
run('turn time', { ...base, allowed_hours: 100, nor_tendered: '2026-06-01T09:20', commencement: { rule: 'turn_time', hours: 12 }, completed: '2026-06-02T09:20' }, { stepHas: '2026-06-01 21:20', despatch_hours: 88 });
// SHEX unless used: Sat 00:00 -> Tue 08:00 = 80 h; Sunday 24 h out but 8 h worked count back: 64 h used of 72: 8 h saved.
run('SHEX unless used', { ...base, terms: 'SHEX', unless_used: true, used: [{ from: '2026-06-07T08:00', to: '2026-06-07T16:00' }], allowed_hours: 72, laytime_commenced: '2026-06-06T00:00', completed: '2026-06-09T08:00' }, { despatch_hours: 8 });
run('unless used without the log of what was worked: NULL', { ...base, terms: 'SHEX', unless_used: true, allowed_hours: 72, laytime_commenced: '2026-06-06T00:00', completed: '2026-06-09T08:00' }, { exit: 2, outcome: 'NULL', nullMissing: 'used' });
// Holiday Wed 3 Jun under SHEX: Mon 00:00 -> Fri 00:00 = 96 h - 24 = 72 h = allowed exactly.
run('holiday excepted under SHEX', { ...base, terms: 'SHEX', holidays: ['2026-06-03'], allowed_hours: 72, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-05T00:00' }, { outcome: 'laytime exactly used', amount: 0 });
run('holiday counts under SHINC', { ...base, holidays: ['2026-06-03'], allowed_hours: 72, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-05T00:00' }, { demurrage_hours: 24 });
// Custom weekend Sat 12:00 -> Mon 08:00 (44 h): Fri 00:00 -> Tue 00:00 = 96 h - 44 = 52 h of 48: 4 h demurrage.
run('custom weekly excepted window', { ...base, excepted_weekly: [{ from: 'Sat 12:00', to: 'Mon 08:00' }], allowed_hours: 48, laytime_commenced: '2026-06-05T00:00', completed: '2026-06-09T00:00' }, { demurrage_hours: 4 });
// NULLs: time still computed, money not.
run('no demurrage rate: time yes, money NULL', { ...base, demurrage_rate_per_day: undefined, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T06:00' }, { exit: 2, demurrage_hours: 6, amount: null, nullMissing: 'demurrage_rate_per_day' });
run('no despatch rate: never assumes half demurrage', { ...base, despatch_rate_per_day: undefined, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-01T18:00' }, { exit: 2, despatch_hours: 6, amount: null, nullMissing: 'half demurrage' });
run('no completion time', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00' }, { exit: 2, outcome: 'NULL', nullMissing: 'completed' });
run('NOR but no commencement rule', { ...base, allowed_hours: 24, nor_tendered: '2026-06-01T00:00', completed: '2026-06-02T00:00' }, { exit: 2, outcome: 'NULL', nullMissing: 'commencement.rule' });
run('no quantity', { ...base, rate_per_day: 10000, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T00:00' }, { exit: 2, outcome: 'NULL', nullMissing: 'quantity' });
run('stoppage with no end', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T00:00', stoppages: [{ from: '2026-06-01T06:00', reason: 'strike' }] }, { exit: 2, outcome: 'NULL', nullMissing: 'strike' });
// invalid input
run('a time with an offset is refused', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00Z', completed: '2026-06-02T00:00' }, { exit: 3 });
run('unknown terms refused', { ...base, terms: 'SOMETIMES', allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T00:00' }, { exit: 3 });
run('count_fraction 1 refused (that is not a stoppage)', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-01T00:00', completed: '2026-06-02T00:00', stoppages: [{ from: '2026-06-01T00:00', to: '2026-06-01T01:00', count_fraction: 1 }] }, { exit: 3 });
run('completion before commencement refused', { ...base, allowed_hours: 24, laytime_commenced: '2026-06-02T00:00', completed: '2026-06-01T00:00' }, { exit: 3 });

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
