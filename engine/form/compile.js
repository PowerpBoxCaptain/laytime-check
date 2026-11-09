// Form state → engine case file. Pure: no DOM, no storage. Shared by the page and by the node validation scripts.
//
// The form holds what the user entered: the printed form and riders (with their positions on each laytime topic),
// the NOR times, the SOF rows, any free-form disputed points, and the figure to check. This file:
//   1. resolves each topic: sources are in precedence order (first prevails); the first source with a position wins;
//      where sources differ, the conflict is reported, and if the user marks the topic disputed each distinct
//      position becomes a reading the engine computes;
//   2. turns SOF rows into stoppages by their category's resolved rule;
//   3. emits a CaseFile the engine runs. Nothing is guessed: a missing input is a problem, reported, not filled.

import { TOPICS, CATEGORIES, labelOf } from './seeds.js';

export const toDate = (s) => {
  if (!s) return null;
  const d = new Date(s.length === 16 ? `${s}:00Z` : s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const num = (x) => (x === '' || x == null || Number.isNaN(Number(x)) ? null : Number(x));
const CAT_LABEL = Object.fromEntries(CATEGORIES);

/** Each topic: who says what, who prevails, and whether it is disputed. */
export function resolveTopics(state) {
  const order = state.sources.map((s) => s.id);
  const src = Object.fromEntries(state.sources.map((s) => [s.id, s]));
  const out = {};
  for (const topic of Object.keys(TOPICS)) {
    const entries = state.positions
      .filter((p) => p.topic === topic && p.value != null && p.value !== '' && src[p.source])
      .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))
      .map((p) => ({ ...p, sourceName: src[p.source].name, cite: `${src[p.source].name}${p.clause ? ` ${p.clause}` : ''}` }));
    const distinct = [];
    for (const e of entries) if (!distinct.some((d) => d.value === e.value)) distinct.push(e);
    out[topic] = {
      topic, entries, winner: entries[0] ?? null, distinct,
      conflict: distinct.length > 1,
      disputed: !!state.disputedTopics?.[topic] && distinct.length > 1,
    };
  }
  return out;
}

const DEFAULTS = { earlier: 'not-counted', onceOnDem: 'yes', despatch: 'none' }; // general rules where no clause speaks
const valueOf = (r, topic) => r[topic].winner?.value ?? DEFAULTS[topic] ?? (TOPICS[topic].kind === 'category' ? 'counts' : null);
const citeOf = (r, topic) => r[topic].winner?.cite ?? (DEFAULTS[topic] || TOPICS[topic].kind === 'category' ? 'no clause: general rule' : '');

function stoppagesFor(rows, value, clause) {
  if (value === 'counts') return [];
  return rows.map((row) => {
    const st = { start: toDate(row.from), end: toDate(row.to), reason: row.what || CAT_LABEL[row.category] || row.category, sourceRef: row.ref, clause };
    if (value === 'excluded') return st;
    if (value === 'excluded-always') return { ...st, appliesOnDemurrage: true };
    if (value === 'half') return { ...st, countFraction: 0.5, appliesOnDemurrage: true };
    if (value === 'prorata') {
      const w = num(row.working), t = num(row.total);
      return { ...st, countFraction: w != null && t ? Math.max(0, Math.min(w / t, 0.999999)) : 0, reason: `${st.reason} (${w ?? '?'} of ${t ?? '?'} cranes working)` };
    }
    return st;
  });
}

export function compile(state, engine) {
  const problems = [];
  const r = resolveTopics(state);
  const t = state.terms ?? {};
  const nor = state.nor ?? {};
  const rows = (state.sof ?? []).map((row, i) => ({ ...row, ref: row.ref || `SOF row ${i + 1}` }));
  for (const row of rows) {
    if (!toDate(row.from) || !toDate(row.to)) problems.push(`${row.ref}: needs a start and an end time`);
    else if (toDate(row.to) <= toDate(row.from)) problems.push(`${row.ref}: ends before it starts`);
  }

  const exceptionRule = valueOf(r, 'exceptions');
  if (!exceptionRule) problems.push('Which days count (SHINC, SHEX ...): no source gives it. Add it to the form, a rider or the recap.');
  const demurrageRate = num(t.demurrageRate);
  const despatchOf = (v) => (num(t.despatchRate) != null ? num(t.despatchRate) : v === 'half' && demurrageRate != null ? demurrageRate / 2 : 0);
  const holidays = String(t.holidays ?? '').split(/[\s,;]+/).filter(Boolean).map((d) => ({ date: toDate(d), affectsLaytime: true })).filter((h) => h.date);
  // Own weekly excepted windows, typed as "Sat 12:00-Mon 08:00; Fri 17:00-Sat 08:00"
  const exceptedWeekly = String(t.weekly ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(\w{3} \d{2}:\d{2})\s*(?:-|–|to)\s*(\w{3} \d{2}:\d{2})$/i.exec(x);
    if (!m) { problems.push(`Weekly window "${x}": write it like "Sat 12:00-Mon 08:00".`); return null; }
    const cap = (w) => w[0].toUpperCase() + w.slice(1, 3).toLowerCase() + w.slice(3);
    return { from: cap(m[1]), to: cap(m[2]) };
  }).filter(Boolean);
  const worked = rows.filter((x) => x.category === 'worked' && !x.disputed);
  const usedPeriods = worked.length ? worked.map((x) => ({ start: toDate(x.from), end: toDate(x.to), sourceRef: x.ref })) : t.uuNoWork ? [] : undefined;

  const terms = {
    quantityMt: num(t.quantityMt), ratePerDayMt: num(t.ratePerDayMt) ?? undefined, allowedHours: num(t.allowedHours) ?? undefined,
    exceptionRule: exceptionRule ?? 'shinc', completedAt: toDate(nor.completed),
    demurrageRate, despatchRate: despatchOf(valueOf(r, 'despatch')),
    despatchBasis: t.despatchBasis || 'laytime_saved', onceOnDemurrage: valueOf(r, 'onceOnDem') !== 'no',
    currency: t.currency || 'USD', ...(holidays.length ? { holidays } : {}), ...(exceptedWeekly.length ? { exceptedWeekly } : {}), ...(usedPeriods ? { usedPeriods } : {}),
  };
  if (!terms.completedAt) problems.push('Completed: when loading or discharging finished is needed.');
  if (terms.quantityMt == null && terms.allowedHours == null) problems.push('Allowed laytime: give the quantity and rate, or the allowed hours. (A missing B/L quantity gives a break-even quantity instead of money.)');
  if (terms.quantityMt != null && !terms.ratePerDayMt && terms.allowedHours == null) problems.push('Rate per day is needed with the quantity.');

  const points = [];

  // ── When laytime starts ──────────────────────────────────────────────────────────────────────────────────
  const RULE = (v) => (v === 'noon' ? { kind: 'noon_split', noon: '12:00', sameDayAt: '13:00', nextWorkingDayAt: '06:00' }
    : v?.startsWith('notice:') ? { kind: 'notice_hours', hours: Number(v.slice(7)) } : null);
  const workStarted = toDate(nor.workStarted);
  const commence = (norAt, rule, earlier) => {
    const proof = engine.commencementByTerms({ norTendered: norAt, exceptionRule: terms.exceptionRule, exceptedWeekly: terms.exceptedWeekly, rule: RULE(rule), holidays });
    if (!proof.commencedAt) return null;
    return earlier === 'counts-from-start' && workStarted && workStarted < proof.commencedAt ? workStarted : proof.commencedAt;
  };
  if (toDate(nor.agreedStart)) {
    terms.commencedAt = toDate(nor.agreedStart);
    terms.commencementRef = 'laytime start as agreed';
  } else {
    const norVariants = [{ id: 'tendered', at: toDate(nor.tendered), label: 'NOR as tendered' }];
    if (nor.disputeAccepted && toDate(nor.accepted)) norVariants.push({ id: 'accepted', at: toDate(nor.accepted), label: 'NOR effective when accepted' });
    if (!norVariants[0].at) problems.push('NOR tendered: needed to work out when laytime starts (or give an agreed start).');
    const pick = (topic) => (r[topic].disputed ? r[topic].distinct.map((d) => ({ v: d.value, cite: d.cite })) : [{ v: valueOf(r, topic), cite: citeOf(r, topic) }]);
    const rules = pick('commencement'), earl = pick('earlier');
    if (!rules[0].v) problems.push('When laytime starts after NOR: no source gives a turn-time or noon rule (or give an agreed start).');
    const variants = [];
    for (const n of norVariants) for (const ru of rules) for (const e of earl) {
      if (!n.at || !ru.v) continue;
      const at = commence(n.at, ru.v, e.v);
      if (!at) { problems.push(`Could not work out commencement for ${n.label} with ${labelOf('commencement', ru.v)}.`); continue; }
      variants.push({ id: [n.id, ru.v, e.v].join('|'), at,
        label: [n.label, labelOf('commencement', ru.v) + (rules.length > 1 ? ` (${ru.cite})` : ''), earl.length > 1 ? `${labelOf('earlier', e.v)} (${e.cite})` : null].filter(Boolean).join(' · ') });
    }
    if (variants.length === 1) { terms.commencedAt = variants[0].at; terms.commencementRef = `${variants[0].label}: ${citeOf(r, 'commencement')}`; }
    else if (variants.length > 1) points.push({ id: 'start', title: 'When laytime started', facts: 'NOR and commencement terms in dispute',
      readings: variants.map((v, i) => ({ id: `S${i}`, label: v.label, why: '', side: i === 0 ? 'owners' : 'charterers', commencedAt: v.at })) });
  }

  // ── Disputed terms ───────────────────────────────────────────────────────────────────────────────────────
  const termPoint = (topic, toTerms) => {
    if (!r[topic].disputed) return;
    points.push({ id: topic, title: TOPICS[topic].label, facts: r[topic].distinct.map((d) => `${d.cite}: ${labelOf(topic, d.value)}`).join(' · '),
      readings: r[topic].distinct.map((d, i) => ({ id: `${topic}${i}`, label: `${labelOf(topic, d.value)} (${d.cite})`, why: d.text || '', side: 'middle', terms: toTerms(d.value) })) });
  };
  termPoint('exceptions', (v) => ({ exceptionRule: v }));
  termPoint('onceOnDem', (v) => ({ onceOnDemurrage: v !== 'no' }));
  termPoint('despatch', (v) => ({ despatchRate: despatchOf(v) }));

  // ── SOF rows by category ─────────────────────────────────────────────────────────────────────────────────
  const base = [];
  for (const [cat] of CATEGORIES) {
    const these = rows.filter((x) => x.category === cat && !x.disputed && toDate(x.from) && toDate(x.to));
    if (!these.length || cat === 'worked' || cat === 'other') continue;
    if (cat === 'agreed') {
      base.push(...these.map((x) => ({ start: toDate(x.from), end: toDate(x.to), reason: x.what || 'agreed exception', sourceRef: x.ref, clause: x.clause || 'agreed',
        ...(x.onDem ? { appliesOnDemurrage: true } : {}), ...(num(x.fraction) ? { countFraction: num(x.fraction) } : {}) })));
      continue;
    }
    if (r[cat].disputed) {
      points.push({ id: cat, title: TOPICS[cat].label, facts: r[cat].distinct.map((d) => `${d.cite}: ${labelOf(cat, d.value)}`).join(' · '),
        readings: r[cat].distinct.map((d, i) => ({ id: `${cat}${i}`, label: `${labelOf(cat, d.value)} (${d.cite})`, why: d.text || '', side: 'middle',
          stoppages: stoppagesFor(these, d.value, d.cite) })) });
    } else base.push(...stoppagesFor(these, valueOf(r, cat), citeOf(r, cat)));
  }

  // ── Single SOF rows the user marked disputed ─────────────────────────────────────────────────────────────
  rows.forEach((x, i) => {
    if (!x.disputed || !toDate(x.from) || !toDate(x.to)) return;
    const cat = TOPICS[x.category]?.kind === 'category' ? x.category : null;
    const rule = cat ? valueOf(r, cat) : 'excluded';
    const off = rule === 'counts' ? 'excluded' : rule;
    const offCite = rule === 'counts' ? 'disputed: no clause found that excludes it' : citeOf(r, cat);
    points.push({ id: `row${i + 1}`, title: x.what || x.ref, facts: `${x.ref}, disputed`, readings: [
      { id: `row${i + 1}-counts`, label: 'Counts', why: '', side: 'owners' },
      { id: `row${i + 1}-off`, label: labelOf(cat ?? 'weather', off), why: offCite, side: 'charterers', stoppages: stoppagesFor([x], off, offCite) },
    ] });
  });

  // ── Free-form disputed points ────────────────────────────────────────────────────────────────────────────
  for (const d of state.disputes ?? []) {
    if (!d.readings?.length) continue;
    points.push({ id: d.id, title: d.title || d.id, facts: d.facts || '', readings: d.readings.map((rd) => ({
      id: rd.id, label: rd.label || rd.id, why: rd.why || '', side: rd.side || 'middle',
      ...(toDate(rd.commencedAt) ? { commencedAt: toDate(rd.commencedAt) } : {}),
      stoppages: (rd.rows ?? []).filter((x) => toDate(x.from) && toDate(x.to)).map((x) => ({ start: toDate(x.from), end: toDate(x.to), reason: x.what || 'stoppage',
        sourceRef: x.ref, clause: x.clause, ...(x.onDem ? { appliesOnDemurrage: true } : {}), ...(num(x.fraction) ? { countFraction: num(x.fraction) } : {}) })),
    })) });
  }

  const cells = points.reduce((n, p) => n * p.readings.length, 1);
  if (cells > 512) problems.push(`${cells} combinations of readings: too many to show. Settle or merge some disputed points.`);
  if (!terms.commencedAt && !points.some((p) => p.readings.some((x) => x.commencedAt))) problems.push('Laytime commencement could not be set.');
  if (terms.exceptionRule === 'uu' && !usedPeriods) problems.push('SHEX unless used: add the SOF rows for work on excepted days, or tick "no work on excepted days". Until then the result is NULL.');

  const quotes = state.positions.filter((p) => p.text).map((p) => ({ field: TOPICS[p.topic]?.label ?? p.topic, text: p.text,
    source: `${state.sources.find((s) => s.id === p.source)?.name ?? p.source}${p.clause ? ` ${p.clause}` : ''}` }));

  const caseFile = { id: state.id || 'form-case', title: state.title || 'Laytime case', terms, quotes, base, points,
    addOns: (state.addOns ?? []).filter((a) => num(a.hours)).map((a) => ({ id: a.id, label: a.label, hours: num(a.hours), when: a.when ?? {} })),
    publicationStatus: 'private' };
  return { caseFile, problems: [...new Set(problems)], resolution: r, combinations: cells };
}
