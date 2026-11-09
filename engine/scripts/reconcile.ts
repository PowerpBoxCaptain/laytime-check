// Reconciliation: the clean-room calculator (../laytime.mjs) against the engine, on the clean-room's own hand-worked
// test cases and its example voyage. Both must agree on every case.
//   cd engine && npm run reconcile
// Exit: 0 all agree · 1 a difference · 3 broke.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCase } from '../src/case.ts';
import { commencementByTerms } from '../src/commencement.ts';

const PUB = process.argv[2] ?? join(import.meta.dirname, '..', '..');
const CLI = join(PUB, 'laytime.mjs');

// 1. Collect the public cases: run test.mjs with its `run` replaced by a collector.
const src = readFileSync(join(PUB, 'test.mjs'), 'utf8')
  .replace(/function run\(name, voyage, want\) \{[\s\S]*?\n\}\n/, 'const CASES = []; function run(name, voyage, want) { CASES.push({ name, voyage, want }); }\n')
  .replace(/\n[^\n]*process\.exit[^\n]*\n?/g, '\n').replace(/\nconsole\.log\(`\\n[^\n]*\n?/g, '\n') + '\nprocess.stdout.write(JSON.stringify(CASES));\n';
const dir = mkdtempSync(join(tmpdir(), 'reconcile-'));
writeFileSync(join(dir, 'collect.mjs'), src.replace(/fileURLToPath\(new URL\('\.\/laytime\.mjs', import\.meta\.url\)\)/, JSON.stringify(CLI)));
const got = spawnSync(process.execPath, [join(dir, 'collect.mjs')], { encoding: 'utf8' });
const lastLine = got.stdout.trim().split('\n').at(-1)!;
const cases: { name: string; voyage: any; want: any }[] = JSON.parse(lastLine);
cases.push({ name: 'example-voyage.json (README figure: USD 17,750 demurrage)', voyage: JSON.parse(readFileSync(join(PUB, 'example-voyage.json'), 'utf8')), want: {} });

// 2. The public voyage format → an engine case. Refusals mirror the public tool's exit 3 (invalid input).
class Invalid extends Error {}
const T = (s: any, what: string) => {
  if (s == null) return null;
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new Invalid(`${what}: not YYYY-MM-DDTHH:MM`);
  return new Date(`${s}:00Z`);
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKLY: Record<string, { from: string; to: string }[]> = { SSHEX: [{ from: 'Sat 00:00', to: 'Mon 00:00' }] };

function toEngine(v: any) {
  const nulls: string[] = [];
  const terms = String(v.terms ?? 'SHINC').toUpperCase();
  if (!['SHINC', 'SHEX', 'FHEX', 'SSHEX'].includes(terms) && !v.excepted_weekly) throw new Invalid('terms');
  const completed = T(v.completed, 'completed');
  if (!completed) nulls.push('completed');
  const holidays = (v.holidays ?? []).map((d: string) => ({ date: new Date(`${d}T00:00:00Z`), affectsLaytime: true }));
  // SSHEX and own weekly windows: the engine has no such rule, so they become excepted periods (laytime only,
  // like excepted days once on demurrage), with SHINC underneath so nothing else is excepted.
  const windows = v.excepted_weekly; // native in the engine since 9 Nov (exceptedWeekly); SSHEX is a rule of its own
  const exceptionRule = windows ? 'shinc' : terms === 'SHEX' ? (v.unless_used ? 'uu' : 'shex') : terms.toLowerCase();
  const usedPeriods = v.unless_used ? (v.used ? v.used.map((u: any) => ({ start: T(u.from, 'used')!, end: T(u.to, 'used')! })) : undefined) : undefined;
  if (v.unless_used && !v.used) nulls.push('used');

  let commencedAt = T(v.laytime_commenced, 'laytime_commenced');
  if (!commencedAt && v.nor_tendered) {
    const rule = v.commencement?.rule === 'turn_time' ? { kind: 'notice_hours' as const, hours: v.commencement.hours }
      : v.commencement?.rule === 'gencon_noon' ? { kind: 'noon_split' as const, noon: '12:00', sameDayAt: '13:00', nextWorkingDayAt: '06:00' } : null;
    if (!rule) nulls.push('commencement.rule');
    else commencedAt = commencementByTerms({ norTendered: T(v.nor_tendered, 'nor_tendered')!, exceptionRule: exceptionRule === 'uu' ? 'shex' : exceptionRule, exceptedWeekly: windows, rule, holidays }).commencedAt;
  }
  if (!commencedAt && !nulls.includes('commencement.rule')) nulls.push('commencement');
  if (commencedAt && completed && completed < commencedAt) throw new Invalid('completion before commencement');

  const stoppages: any[] = [];
  for (const s of v.stoppages ?? []) {
    if (s.count_fraction != null && !(s.count_fraction >= 0 && s.count_fraction < 1)) throw new Invalid('count_fraction');
    if (!s.to) { nulls.push(s.reason ?? 'stoppage end'); continue; }
    stoppages.push({ start: T(s.from, 'stoppage')!, end: T(s.to, 'stoppage')!, reason: s.reason ?? 'stoppage', ...(s.count_fraction != null ? { countFraction: s.count_fraction } : {}), ...(s.on_demurrage ? { appliesOnDemurrage: true } : {}) });
  }
  if (v.quantity == null && v.allowed_hours == null) nulls.push('quantity');
  return {
    nulls,
    c: { id: 'x', title: 'x', quotes: [], points: [], base: stoppages,
      terms: { quantityMt: v.quantity ?? null, ratePerDayMt: v.rate_per_day, allowedHours: v.allowed_hours, exceptionRule, commencedAt: commencedAt ?? undefined,
        completedAt: completed ?? new Date(0), demurrageRate: v.demurrage_rate_per_day ?? null, despatchRate: v.despatch_rate_per_day ?? null,
        despatchBasis: v.despatch_basis, onceOnDemurrage: v.once_on_demurrage !== false, exceptedWeekly: windows, holidays: terms === 'SHINC' && !v.holidays_excepted ? [] : holidays, usedPeriods, currency: v.currency } },
  };
}

// 3. Both, side by side.
const r3 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 1000);
let diffs = 0;
const rows: string[] = [];
for (const { name, voyage } of cases) {
  const p = spawnSync(process.execPath, [CLI, '--json'], { input: JSON.stringify(voyage), encoding: 'utf8' });
  let pub: any = {}; try { pub = JSON.parse(p.stdout); } catch {}
  const P = p.status === 3 ? { kind: 'invalid' } : { kind: pub.result?.outcome ?? 'NULL', dem: r3(pub.result?.demurrage_hours), desp: r3(pub.result?.despatch_hours), amount: pub.result?.amount == null ? null : r3(pub.result.amount) };
  let E: any;
  try {
    const { c, nulls } = toEngine(voyage);
    if (nulls.length && !c.terms.commencedAt) E = { kind: 'NULL', why: nulls.join(', ') };
    else {
      const cell = runCase(c as any).cells[0];
      const over = cell.overHours;
      if (nulls.length) E = { kind: 'NULL', why: nulls.join(', ') };
      else if (cell.result === 'NULL' || over == null) E = { kind: over == null ? 'NULL' : over > 1e-9 ? 'on demurrage' : over < -1e-9 ? 'on despatch' : 'laytime exactly used',
        dem: over != null && over > 1e-9 ? r3(over) : null, desp: over != null && over < -1e-9 ? r3(-over) : null, amount: null, why: [...nulls, ...cell.nulls].join(', ') || 'engine NULL' };
      else E = { kind: over > 1e-9 ? 'on demurrage' : over < -1e-9 ? 'on despatch' : 'laytime exactly used', dem: over > 1e-9 ? r3(over) : null, desp: over < -1e-9 ? r3(-over) : null, amount: cell.total == null ? null : Math.round(Math.abs(cell.total) * 100) / 100 };
      // public despatch_hours under all time saved are the hours saved on that basis; the engine keeps laytime hours
      if (voyage.despatch_basis === 'all_time_saved' && E.kind === 'on despatch') E.desp = pub.result?.despatch_hours ?? E.desp;
    }
  } catch (e) { E = e instanceof Invalid ? { kind: 'invalid' } : { kind: 'ENGINE THREW', why: (e as Error).message }; }
  const same = P.kind === E.kind && (P.kind === 'invalid' || (P.dem === (E.dem ?? null) && P.desp === (E.desp ?? null) && P.amount === (E.amount ?? null)) || (P.kind === 'NULL' && E.kind === 'NULL'));
  if (!same) diffs++;
  rows.push(`${same ? 'agree ' : 'DIFFER'} ${name}${same ? '' : `\n         public: ${JSON.stringify(P)}\n         engine: ${JSON.stringify(E)}`}`);
}
console.log(rows.join('\n'));
console.log(`\n${cases.length - diffs} of ${cases.length} agree`);
process.exitCode = diffs ? 1 : 0;
