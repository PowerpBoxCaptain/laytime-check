// The laytime form: UI over compile.js and the engine. Runs entirely in the browser; cases are kept in this browser
// only (localStorage), and move in or out as JSON the user copies or pastes.
import { runCase, checkSheet, formatTrace, traceCell, commencementByTerms } from '../src/index.ts';
import { compile, resolveTopics } from './compile.js';
import { TOPICS, FORMS, RIDERS, CATEGORIES, SIDES, labelOf } from './seeds.js';

const engine = { commencementByTerms };
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 8);
const money = (x, cur = 'USD') => (x == null ? 'NULL' : `${cur} ${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// ── Example: an invented voyage, marked as such ─────────────────────────────────────────────────────────────
function example() {
  return {
    v: 1, id: `case-${uid()}`, example: true,
    title: 'Example: MV Sample Trader, discharging 33,000 MT bulk',
    terms: { quantityMt: 33000, ratePerDayMt: 8000, demurrageRate: 12000, despatchRate: '', currency: 'USD', despatchBasis: 'laytime_saved', holidays: '', uuNoWork: false },
    sources: [
      { id: 'recap', kind: 'recap', name: 'Recap' },
      { id: 'r1', kind: 'rider', name: 'Rider' },
      { id: 'main', kind: 'main', name: 'GENCON 1994', formId: 'gencon94' },
    ],
    positions: [
      { id: uid(), source: 'recap', topic: 'exceptions', value: 'shinc', clause: 'cl. 8', text: '8,000 MT PWWD SHINC' },
      { id: uid(), source: 'recap', topic: 'despatch', value: 'half', clause: 'cl. 9', text: 'DEM USD 12,000 PDPR / DESPATCH HALF' },
      { id: uid(), source: 'recap', topic: 'weather', value: 'counts', clause: 'cl. 8', text: 'ALL WEATHER DELAYS TO COUNT' },
      { id: uid(), source: 'r1', topic: 'weather', value: 'excluded', clause: 'cl. 31', text: 'TIME LOST BY BAD WEATHER PREVENTING WORK NOT TO COUNT' },
      { id: uid(), source: 'r1', topic: 'cranes', value: 'prorata', clause: 'cl. 33', text: 'IN CASE OF BREAKDOWN OF SHIP\'S CRANES, LAYTIME TO COUNT PRO RATA' },
      { id: uid(), source: 'r1', topic: 'surveys', value: 'excluded', clause: 'cl. 35', text: 'INITIAL DRAFT SURVEY NOT TO COUNT' },
      ...seedPositions('main', 'gencon94'),
    ],
    disputedTopics: { weather: true },
    nor: { tendered: '2026-06-01T09:20', accepted: '', disputeAccepted: false, workStarted: '2026-06-01T15:00', completed: '2026-06-06T11:30', agreedStart: '' },
    sof: [
      { id: uid(), from: '2026-06-01T13:00', to: '2026-06-01T14:30', what: 'Initial draft survey', category: 'surveys', ref: 'SOF p1', disputed: false },
      { id: uid(), from: '2026-06-02T22:10', to: '2026-06-03T04:40', what: 'Rain, hatches closed', category: 'weather', ref: 'SOF p2', disputed: false },
      { id: uid(), from: '2026-06-03T10:00', to: '2026-06-03T22:00', what: 'Crane no. 2 down', category: 'cranes', working: 3, total: 4, ref: 'SOF p2', disputed: false },
      { id: uid(), from: '2026-06-04T16:00', to: '2026-06-04T19:00', what: 'No trucks, cargo not ready', category: 'shore', ref: 'SOF p3', disputed: true },
    ],
    disputes: [], addOns: [],
    sheet: { amount: 6025, kind: 'demurrage', label: 'Owners\' laytime statement (example)' },
  };
}
function seedPositions(sourceId, formId) {
  const f = FORMS.find((x) => x.id === formId);
  if (!f) return [];
  return Object.entries(f.p).map(([topic, value]) => ({ id: uid(), source: sourceId, topic, value: value ?? '', clause: '', text: '', typical: value != null }));
}
function blank() {
  return { v: 1, id: `case-${uid()}`, title: 'New case', terms: { currency: 'USD', despatchBasis: 'laytime_saved' },
    sources: [{ id: 'recap', kind: 'recap', name: 'Recap' }, { id: 'main', kind: 'main', name: 'GENCON 1994', formId: 'gencon94' }],
    positions: seedPositions('main', 'gencon94'), disputedTopics: {}, nor: {}, sof: [], disputes: [], addOns: [], sheet: { kind: 'demurrage' } };
}

// ── State ───────────────────────────────────────────────────────────────────────────────────────────────────
let cases = store.get('laytime.cases', null);
let state;
if (cases && Object.keys(cases).length) state = cases[store.get('laytime.current', Object.keys(cases)[0])] ?? Object.values(cases)[0];
else { state = example(); cases = {}; }
let picked = null; // cell key whose ledger is shown

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks.at(-1)] = val;
}

function save(quiet) {
  cases[state.id] = state;
  const ok = store.set('laytime.cases', cases) && store.set('laytime.current', state.id);
  if (!quiet) toast(ok ? 'Saved in this browser' : 'This browser would not save it. Use "Copy as JSON" to keep a copy.');
  renderCaseBar();
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
const field = (label, path, type = 'text', extra = '') => {
  const v = getPath(state, path) ?? '';
  return `<label class="fld"><span>${esc(label)}</span><input id="f-${path.replace(/\./g, '-')}" type="${type}" data-bind="${path}" value="${esc(v)}" ${extra}></label>`;
};
const dt = (label, path, hint = '') => `<label class="fld"><span>${esc(label)}${hint ? ` <em>${esc(hint)}</em>` : ''}</span><input id="f-${path.replace(/\./g, '-')}" type="datetime-local" data-bind="${path}" value="${esc(String(getPath(state, path) ?? '').slice(0, 16))}"></label>`;

function renderCaseBar() {
  const all = { ...cases, [state.id]: state };
  $('#caseSel').innerHTML = Object.values(all).map((c) => opt(c.id, c.title || c.id, state.id)).join('');
}

function renderVoyage() {
  $('#voyage').innerHTML = `
    ${state.example ? '<p class="note ex">An invented voyage, loaded to show what the form does. Start a new case for your own.</p>' : ''}
    <div class="grid">
      <label class="fld wide"><span>Case name</span><input id="f-title" data-bind="title" value="${esc(state.title)}"></label>
      ${field('Cargo quantity (MT, as per B/L)', 'terms.quantityMt', 'number', 'min="0" step="any"')}
      ${field('Rate per day (MT)', 'terms.ratePerDayMt', 'number', 'min="0" step="any"')}
      ${field('Or allowed laytime (hours)', 'terms.allowedHours', 'number', 'min="0" step="any"')}
      ${field('Demurrage per day', 'terms.demurrageRate', 'number', 'min="0" step="any"')}
      ${field('Despatch per day (blank = from the terms)', 'terms.despatchRate', 'number', 'min="0" step="any"')}
      ${field('Currency', 'terms.currency')}
      <label class="fld"><span>Despatch on</span><select id="f-terms-despatchBasis" data-bind="terms.despatchBasis">
        ${opt('laytime_saved', 'Laytime saved', state.terms.despatchBasis)}${opt('all_time_saved', 'All time saved', state.terms.despatchBasis)}</select></label>
      <label class="fld wide"><span>Port holidays <em>dates, e.g. 2026-06-05, 2026-06-06</em></span><input id="f-terms-holidays" data-bind="terms.holidays" value="${esc(state.terms.holidays ?? '')}"></label>
      <label class="fld wide"><span>Excepted weekly windows <em>port time, e.g. Sat 12:00-Mon 08:00; Fri 17:00-Sat 08:00</em></span><input id="f-terms-weekly" data-bind="terms.weekly" value="${esc(state.terms.weekly ?? '')}"></label>
      <label class="chk wide"><input id="f-terms-uuNoWork" type="checkbox" data-bind="terms.uuNoWork" ${state.terms.uuNoWork ? 'checked' : ''}> SHEX unless used: no work was done on excepted days</label>
    </div>`;
}

function renderSources() {
  const r = resolveTopics(state);
  const html = state.sources.map((s, i) => {
    const pos = state.positions.filter((p) => p.source === s.id);
    const form = FORMS.find((f) => f.id === s.formId);
    return `<article class="src" data-src="${s.id}">
      <header>
        <span class="rank" title="Precedence">${i + 1}</span>
        <input id="src-name-${s.id}" class="srcname" data-src-name="${s.id}" value="${esc(s.name)}" aria-label="Source name">
        <span class="kind">${esc({ main: 'Printed form', rider: 'Rider', recap: 'Recap / fixture note', typed: 'Typed clause' }[s.kind] ?? s.kind)}</span>
        <span class="tools">
          <button type="button" class="ghost" data-act="up" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Higher precedence">▲</button>
          <button type="button" class="ghost" data-act="down" data-id="${s.id}" ${i === state.sources.length - 1 ? 'disabled' : ''} aria-label="Lower precedence">▼</button>
          <button type="button" class="ghost" data-act="delsrc" data-id="${s.id}">Remove</button>
        </span>
      </header>
      ${form ? `<p class="note">${esc(form.by)}${form.fits ? ` · ${esc(form.fits)}` : ''}. ${esc(form.note)}</p>` : ''}
      <div class="tbl"><table>
        <thead><tr><th>Topic</th><th>What it says</th><th>Clause</th><th>Clause text (paste it)</th><th></th></tr></thead>
        <tbody>${pos.map((p) => `<tr>
          <td>${esc(TOPICS[p.topic]?.label ?? p.topic)}${p.typical ? '<span class="typ" title="Typical position of the printed form, from general knowledge. Confirm against your copy.">typical</span>' : ''}</td>
          <td><select id="pos-v-${p.id}" data-pos="${p.id}" data-k="value">${opt('', 'Not stated', p.value)}${TOPICS[p.topic].options.map((o) => opt(o, labelOf(p.topic, o), p.value)).join('')}</select></td>
          <td><input id="pos-c-${p.id}" class="short" data-pos="${p.id}" data-k="clause" value="${esc(p.clause)}" placeholder="cl."></td>
          <td><textarea id="pos-t-${p.id}" rows="1" data-pos="${p.id}" data-k="text" placeholder="Paste the words">${esc(p.text)}</textarea></td>
          <td><button type="button" class="ghost" data-act="delpos" data-id="${p.id}" aria-label="Remove">✕</button></td></tr>`).join('')}
        </tbody></table></div>
      <div class="row">
        <select id="addpos-${s.id}" aria-label="Topic to add">${Object.entries(TOPICS).map(([k, t]) => opt(k, t.label)).join('')}</select>
        <button type="button" data-act="addpos" data-id="${s.id}">Add a term</button>
      </div>
    </article>`;
  }).join('');
  $('#sources').innerHTML = `
    <p class="note">Sources are listed in order of precedence: where two disagree, the higher one prevails, unless you mark the topic disputed below. Typed recap and rider terms usually prevail over the printed form; check your charter party's own precedence clause.</p>
    ${html}
    <div class="row adders">
      <select id="addform" aria-label="Printed form">${FORMS.map((f) => opt(f.id, f.name)).join('')}</select><button type="button" data-act="addform">Add printed form</button>
      <select id="addrider" aria-label="Rider clause">${opt('', 'Blank rider')}${RIDERS.map((x) => opt(x.id, x.name)).join('')}</select><button type="button" data-act="addrider">Add rider</button>
      <button type="button" data-act="addrecap">Add recap</button>
    </div>`;
  renderResolution(r);
}

function renderResolution(r = resolveTopics(state)) {
  const rows = Object.entries(TOPICS).map(([k, t]) => {
    const x = r[k];
    if (!x.entries.length) return '';
    const win = x.winner;
    return `<tr class="${x.conflict ? 'clash' : ''}">
      <td>${esc(t.label)}</td>
      <td>${x.disputed ? '<span class="pill amber">disputed: every position computed</span>' : `${esc(labelOf(k, win.value))}<div class="cite">${esc(win.cite)}</div>`}</td>
      <td>${x.conflict ? x.distinct.map((d) => `<div>${esc(d.cite)}: ${esc(labelOf(k, d.value))}</div>`).join('') : '<span class="muted">no conflict</span>'}</td>
      <td>${x.conflict ? `<label class="chk"><input id="dsp-${k}" type="checkbox" data-dispute="${k}" ${state.disputedTopics?.[k] ? 'checked' : ''}> Disputed</label>` : ''}</td></tr>`;
  }).join('');
  $('#resolution').innerHTML = `<div class="tbl"><table><thead><tr><th>Topic</th><th>Applies</th><th>Where sources differ</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No terms entered yet.</td></tr>'}</tbody></table></div>
    <p class="note">Topics no source mentions follow the general rule: time counts unless an exception applies; once on demurrage, always on demurrage; no despatch unless agreed.</p>`;
}

function renderNor() {
  $('#nor').innerHTML = `<div class="grid">
    ${dt('NOR tendered', 'nor.tendered')}
    ${dt('NOR accepted', 'nor.accepted', 'if later')}
    <label class="chk"><input id="f-nor-disputeAccepted" type="checkbox" data-bind="nor.disputeAccepted" ${state.nor.disputeAccepted ? 'checked' : ''}> Dispute: NOR effective only when accepted</label>
    ${dt('Work started', 'nor.workStarted')}
    ${dt('Work completed', 'nor.completed')}
    ${dt('Or: laytime start agreed', 'nor.agreedStart', 'skips the NOR terms')}
  </div>`;
}

function renderSof() {
  $('#sof').innerHTML = `<div class="tbl"><table class="sof">
    <thead><tr><th>From</th><th>To</th><th>What happened</th><th>Category</th><th>Cranes up / of</th><th>Ref</th><th>Disputed</th><th></th></tr></thead>
    <tbody>${state.sof.map((x) => `<tr>
      <td><input id="sof-f-${x.id}" type="datetime-local" data-sof="${x.id}" data-k="from" value="${esc(String(x.from ?? '').slice(0, 16))}"></td>
      <td><input id="sof-t-${x.id}" type="datetime-local" data-sof="${x.id}" data-k="to" value="${esc(String(x.to ?? '').slice(0, 16))}"></td>
      <td><input id="sof-w-${x.id}" data-sof="${x.id}" data-k="what" value="${esc(x.what)}"></td>
      <td><select id="sof-c-${x.id}" data-sof="${x.id}" data-k="category">${CATEGORIES.map(([v, l]) => opt(v, l, x.category)).join('')}</select></td>
      <td class="cr">${x.category === 'cranes' ? `<input id="sof-wk-${x.id}" class="tiny" type="number" min="0" data-sof="${x.id}" data-k="working" value="${esc(x.working)}"> / <input id="sof-tt-${x.id}" class="tiny" type="number" min="1" data-sof="${x.id}" data-k="total" value="${esc(x.total)}">` : x.category === 'agreed' ? `<label class="chk"><input id="sof-od-${x.id}" type="checkbox" data-sof="${x.id}" data-k="onDem" ${x.onDem ? 'checked' : ''}> also on dem.</label>` : ''}</td>
      <td><input id="sof-r-${x.id}" class="short" data-sof="${x.id}" data-k="ref" value="${esc(x.ref)}" placeholder="SOF p1"></td>
      <td><input id="sof-d-${x.id}" type="checkbox" data-sof="${x.id}" data-k="disputed" ${x.disputed ? 'checked' : ''} aria-label="Disputed"></td>
      <td><button type="button" class="ghost" data-act="delsof" data-id="${x.id}" aria-label="Remove row">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button type="button" data-act="addsof">Add SOF row</button>
    <span class="note">Enter only interruptions and events that matter to laytime. Times are port local time.</span></div>`;
}

function renderDisputes() {
  $('#disputes').innerHTML = (state.disputes ?? []).map((d) => `<article class="src">
    <header><input id="dp-t-${d.id}" class="srcname" data-dp="${d.id}" data-k="title" value="${esc(d.title)}" placeholder="What is disputed">
      <span class="tools"><button type="button" class="ghost" data-act="deldp" data-id="${d.id}">Remove</button></span></header>
    <label class="fld wide"><span>Facts (from the SOF and remarks)</span><textarea id="dp-f-${d.id}" rows="2" data-dp="${d.id}" data-k="facts">${esc(d.facts)}</textarea></label>
    ${d.readings.map((rd) => `<div class="reading">
      <div class="grid">
        <label class="fld"><span>Reading</span><input id="rd-l-${rd.id}" data-rd="${d.id}:${rd.id}" data-k="label" value="${esc(rd.label)}"></label>
        <label class="fld"><span>Whose</span><select id="rd-s-${rd.id}" data-rd="${d.id}:${rd.id}" data-k="side">${SIDES.map((s) => opt(s, s, rd.side)).join('')}</select></label>
        <label class="fld"><span>Laytime starts <em>if this reading moves it</em></span><input id="rd-c-${rd.id}" type="datetime-local" data-rd="${d.id}:${rd.id}" data-k="commencedAt" value="${esc(String(rd.commencedAt ?? '').slice(0, 16))}"></label>
      </div>
      ${(rd.rows ?? []).map((x, j) => `<div class="row mini">
        <input id="rr-f-${rd.id}-${j}" type="datetime-local" data-rr="${d.id}:${rd.id}:${j}" data-k="from" value="${esc(String(x.from ?? '').slice(0, 16))}" aria-label="From">
        <input id="rr-t-${rd.id}-${j}" type="datetime-local" data-rr="${d.id}:${rd.id}:${j}" data-k="to" value="${esc(String(x.to ?? '').slice(0, 16))}" aria-label="To">
        <input id="rr-w-${rd.id}-${j}" data-rr="${d.id}:${rd.id}:${j}" data-k="what" value="${esc(x.what)}" placeholder="Time off laytime: why">
        <input id="rr-p-${rd.id}-${j}" class="tiny" type="number" min="0" max="0.99" step="0.05" data-rr="${d.id}:${rd.id}:${j}" data-k="fraction" value="${esc(x.fraction)}" title="Share that still counts, e.g. 0.75 for 3 of 4 cranes" placeholder="0">
        <label class="chk"><input id="rr-o-${rd.id}-${j}" type="checkbox" data-rr="${d.id}:${rd.id}:${j}" data-k="onDem" ${x.onDem ? 'checked' : ''}> on dem.</label>
        <button type="button" class="ghost" data-act="delrr" data-id="${d.id}:${rd.id}:${j}" aria-label="Remove">✕</button></div>`).join('')}
      <div class="row"><button type="button" class="ghost" data-act="addrr" data-id="${d.id}:${rd.id}">Add time off under this reading</button>
      <button type="button" class="ghost" data-act="delrd" data-id="${d.id}:${rd.id}">Remove reading</button></div>
    </div>`).join('')}
    <div class="row"><button type="button" data-act="addrd" data-id="${d.id}">Add a reading</button></div>
  </article>`).join('') + `<div class="row"><button type="button" data-act="adddp">Add a disputed point</button>
    <span class="note">For points the clauses alone do not settle: a NOR given before arrival, a stop both sides blame on the other.</span></div>`;
}

function renderSheet() {
  const s = state.sheet ??= { kind: 'demurrage' };
  $('#sheet').innerHTML = `<div class="grid">
    ${field('Figure on the sheet', 'sheet.amount', 'number', 'min="0" step="any"')}
    <label class="fld"><span>It claims</span><select id="f-sheet-kind" data-bind="sheet.kind">${opt('demurrage', 'Demurrage', s.kind)}${opt('despatch', 'Despatch', s.kind)}</select></label>
    ${field('Whose sheet', 'sheet.label')}
  </div>`;
}

function renderAll() { renderCaseBar(); renderVoyage(); renderSources(); renderNor(); renderSof(); renderDisputes(); renderSheet(); recompute(); }

// ── Results ─────────────────────────────────────────────────────────────────────────────────────────────────
let lastCase = null;
function recompute() {
  const out = $('#result');
  let res;
  try { res = compile(state, engine); } catch (e) { out.innerHTML = `<div class="problems"><h3>Could not read the form</h3><p>${esc(e.message)}</p></div>`; return; }
  const { caseFile, problems } = res;
  lastCase = caseFile;
  const blocking = problems.filter((p) => !/break-even|NULL/.test(p));
  let html = problems.length ? `<div class="problems"><h3>${blocking.length ? 'Needed before a figure' : 'Note'}</h3><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
  if (blocking.length) { out.innerHTML = html; return; }
  let run;
  try { run = runCase(caseFile); } catch (e) { out.innerHTML = `${html}<div class="problems"><p>${esc(e.message)}</p></div>`; return; }
  const cur = caseFile.terms.currency;
  const short = (t) => (t.length > 34 ? `${t.slice(0, 32)}…` : t);
  const label = (cell) => caseFile.points.map((p) => `${short(p.title)}: ${p.readings.find((r) => r.id === cell.readings[p.id])?.label}`).join(' · ') || 'As entered';
  const sheet = state.sheet;
  let chk = null;
  if (sheet?.amount !== '' && sheet?.amount != null && !Number.isNaN(Number(sheet.amount))) {
    try { chk = checkSheet(caseFile, { amount: Number(sheet.amount), kind: sheet.kind, tolerance: 0.01 }); } catch (e) { html += `<p class="muted">${esc(e.message)}</p>`; }
  }
  const VERDICT = { agrees: ['good', 'Agrees'], reproduced: ['good', 'Reproduced'], 'agrees-under-other-readings': ['good', 'Reproduced'], differs: ['bad', 'Differs'], null: ['amber', 'No figure'] };
  if (chk) {
    const [tone, word] = VERDICT[chk.verdict];
    html += `<div class="verdict ${tone}"><span class="pill ${tone}">${word}</span>
      <p><strong>${esc(sheet.label || 'The sheet')}</strong>: ${sheet.kind} ${money(Number(sheet.amount), cur)}.</p>
      ${chk.matches.length ? `<p>Reproduced to the cent under: <strong>${chk.matches.map((m) => esc(label(m))).join('</strong>; or <strong>')}</strong>.</p>`
        : chk.nearest ? `<p>No reading gives this figure. Nearest: <strong>${esc(label(chk.nearest))}</strong>, ${money(chk.nearest.amount, cur)} ${chk.nearest.kind}, a difference of ${money(chk.nearest.difference, cur)}. Open its ledger below and compare line by line.</p>` : ''}
    </div>`;
    if (!picked) picked = (chk.matches[0] ?? chk.nearest)?.key ?? null;
  }
  if (run.range) {
    const lo = run.range.min, hi = run.range.max;
    html += `<div class="range"><h3>What the documents allow</h3><p class="big">${lo === hi ? money(lo, cur) : `${money(lo, cur)} ${lo < 0 ? 'despatch' : 'demurrage'} <span>to</span> ${money(hi, cur)} ${hi < 0 ? 'despatch' : 'demurrage'}`}</p></div>`;
  }
  if (run.swing.length) {
    const max = Math.max(...run.swing.map((s) => (Number.isNaN(s.size) ? 0 : s.size)), 1);
    html += `<h3>Where the money moves</h3><ul class="swing">${run.swing.map((s) => {
      const p = caseFile.points.find((x) => x.id === s.point);
      return `<li><span class="lbl">${esc(p?.title ?? s.point)}</span><span class="bar"><i style="width:${Number.isNaN(s.size) ? 0 : Math.max(2, (s.size / max) * 100)}%"></i></span><span class="num">${Number.isNaN(s.size) ? 'n/a' : money(s.size, cur)}</span></li>`;
    }).join('')}</ul>`;
  }
  html += `<h3>Every reading</h3><div class="tbl"><table class="cells"><thead><tr><th>Readings</th><th class="n">Used h</th><th class="n">Over / under h</th><th class="n">Amount</th></tr></thead><tbody>
    ${run.cells.map((c) => `<tr class="${c.key === picked ? 'on' : ''} ${chk?.matches.some((m) => m.key === c.key) ? 'hit' : ''}" data-cell="${esc(c.key)}" tabindex="0">
      <td>${esc(label(c))}</td><td class="n">${c.usedHours == null ? '—' : c.usedHours.toFixed(3)}</td>
      <td class="n">${c.overHours == null ? '—' : c.overHours.toFixed(3)}</td>
      <td class="n">${c.total == null ? `NULL${c.breakEvenMt ? `<div class="cite">break-even ${Math.round(c.breakEvenMt).toLocaleString('en-US')} MT</div>` : ''}` : `${money(c.total, cur)} <span class="k">${c.total > 0 ? 'dem' : c.total < 0 ? 'desp' : ''}</span>`}</td></tr>`).join('')}
    </tbody></table></div>`;
  const cell = run.cells.find((c) => c.key === picked) ?? run.cells[0];
  if (cell) {
    let lines = [];
    try { const proof = traceCell(caseFile, cell.readings); lines = proof ? formatTrace(proof, fmt) : ['No commencement for this reading.']; } catch (e) { lines = [e.message]; }
    html += `<h3>Ledger: ${esc(label(cell))}</h3><pre class="ledger">${lines.map((l) => esc(l)).join('\n')}</pre>`;
  }
  out.innerHTML = html;
}

// ── Events ──────────────────────────────────────────────────────────────────────────────────────────────────
let rt;
const soon = () => { clearTimeout(rt); rt = setTimeout(() => { recompute(); save(true); }, 250); };
const findRd = (key) => { const [d, r] = key.split(':'); const dp = state.disputes.find((x) => x.id === d); return [dp, dp?.readings.find((x) => x.id === r)]; };

document.addEventListener('input', (e) => {
  const el = e.target, val = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.bind) { setPath(state, el.dataset.bind, val); if (el.dataset.bind === 'title') renderCaseBar(); }
  else if (el.dataset.srcName) state.sources.find((s) => s.id === el.dataset.srcName).name = val;
  else if (el.dataset.pos) { const p = state.positions.find((x) => x.id === el.dataset.pos); p[el.dataset.k] = val; if (el.dataset.k === 'value') p.typical = false; renderResolution(); }
  else if (el.dataset.sof) { const x = state.sof.find((r) => r.id === el.dataset.sof); x[el.dataset.k] = val; if (el.dataset.k === 'category') renderSof(); }
  else if (el.dataset.dispute) { state.disputedTopics[el.dataset.dispute] = el.checked; renderResolution(); }
  else if (el.dataset.dp) state.disputes.find((x) => x.id === el.dataset.dp)[el.dataset.k] = val;
  else if (el.dataset.rd) findRd(el.dataset.rd)[1][el.dataset.k] = val;
  else if (el.dataset.rr) { const [d, r, j] = el.dataset.rr.split(':'); findRd(`${d}:${r}`)[1].rows[Number(j)][el.dataset.k] = val; }
  else return;
  if (state.example && el.dataset.bind !== 'sheet.amount') state.example = false;
  soon();
});

document.addEventListener('click', (e) => {
  const cellRow = e.target.closest('[data-cell]');
  if (cellRow) { picked = cellRow.dataset.cell; recompute(); return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  const i = state.sources.findIndex((s) => s.id === id);
  switch (act) {
    case 'up': [state.sources[i - 1], state.sources[i]] = [state.sources[i], state.sources[i - 1]]; break;
    case 'down': [state.sources[i + 1], state.sources[i]] = [state.sources[i], state.sources[i + 1]]; break;
    case 'delsrc': state.sources.splice(i, 1); state.positions = state.positions.filter((p) => p.source !== id); break;
    case 'delpos': state.positions = state.positions.filter((p) => p.id !== id); break;
    case 'addpos': state.positions.push({ id: uid(), source: id, topic: $(`#addpos-${id}`).value, value: '', clause: '', text: '' }); break;
    case 'addform': { const f = FORMS.find((x) => x.id === $('#addform').value); const sid = `src-${uid()}`;
      state.sources.push({ id: sid, kind: 'main', name: f.name, formId: f.id }); state.positions.push(...seedPositions(sid, f.id)); break; }
    case 'addrider': { const rd = RIDERS.find((x) => x.id === $('#addrider').value); const sid = `src-${uid()}`;
      state.sources.unshift({ id: sid, kind: 'rider', name: `Rider${rd ? `: ${rd.name}` : ''}` });
      if (rd) for (const [topic, value] of Object.entries(rd.set)) state.positions.push({ id: uid(), source: sid, topic, value, clause: '', text: '' });
      break; }
    case 'addrecap': state.sources.unshift({ id: `src-${uid()}`, kind: 'recap', name: 'Recap' }); break;
    case 'addsof': { const last = state.sof.at(-1); state.sof.push({ id: uid(), from: last?.to ?? '', to: '', what: '', category: 'weather', ref: '', disputed: false }); break; }
    case 'delsof': state.sof = state.sof.filter((x) => x.id !== id); break;
    case 'adddp': state.disputes.push({ id: `dp${uid()}`, title: '', facts: '', readings: [
      { id: `r${uid()}`, label: 'Owners\' reading', side: 'owners', rows: [] }, { id: `r${uid()}`, label: 'Charterers\' reading', side: 'charterers', rows: [] }] }); break;
    case 'deldp': state.disputes = state.disputes.filter((x) => x.id !== id); break;
    case 'addrd': state.disputes.find((x) => x.id === id).readings.push({ id: `r${uid()}`, label: 'Another reading', side: 'middle', rows: [] }); break;
    case 'delrd': { const [dp, rd] = findRd(id); dp.readings = dp.readings.filter((x) => x !== rd); break; }
    case 'addrr': { const rd = findRd(id)[1]; (rd.rows ??= []).push({ from: '', to: '', what: '', fraction: '', onDem: false }); break; }
    case 'delrr': { const [d, r, j] = id.split(':'); findRd(`${d}:${r}`)[1].rows.splice(Number(j), 1); break; }
    case 'new': save(true); state = blank(); picked = null; break;
    case 'example': save(true); state = example(); picked = null; break;
    case 'dup': save(true); state = { ...structuredClone(state), id: `case-${uid()}`, title: `${state.title} (copy)` }; break;
    case 'del': { if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Delete: click again'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Delete'; }, 3000); return; }
      delete cases[state.id]; store.set('laytime.cases', cases); state = Object.values(cases)[0] ?? example(); picked = null; break; }
    case 'save': save(); return;
    case 'export': showIO(JSON.stringify(state, null, 1), 'Your case as JSON. Copy it to keep it or move it to another browser.'); return;
    case 'mcp': showIO(JSON.stringify(lastCase, null, 1), 'The engine case file: pass it as "case" to the laytime_check MCP tool.'); return;
    case 'import': showIO('', 'Paste a case exported from this form, then press Load.', true); return;
    case 'load': try { const s = JSON.parse($('#io-text').value); if (!s.sources || !s.terms) throw new Error('This is not a case from this form.');
      s.id ??= `case-${uid()}`; state = s; picked = null; $('#io').hidden = true; save(); } catch (err) { toast(`Could not load: ${err.message}`); return; } break;
    case 'copy': { const ta = $('#io-text'); navigator.clipboard?.writeText(ta.value).then(() => toast('Copied'), () => { ta.select(); toast('Press Ctrl+C to copy'); }) ?? (ta.select(), toast('Press Ctrl+C to copy')); return; }
    case 'closeio': $('#io').hidden = true; return;
    default: return;
  }
  renderAll(); save(true);
});
$('#caseSel').addEventListener('change', (e) => { save(true); state = cases[e.target.value] ?? state; picked = null; store.set('laytime.current', state.id); renderAll(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.cell) { picked = e.target.dataset.cell; recompute(); } });

function showIO(text, note, editable = false) {
  $('#io').hidden = false; $('#io-note').textContent = note; const ta = $('#io-text'); ta.value = text; ta.readOnly = !editable;
  $('#io-load').hidden = !editable; $('#io-copy').hidden = editable; ta.focus();
}

renderAll();
