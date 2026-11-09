// Seeds for the laytime form: the questions a charter party answers about laytime, the printed forms in common use,
// and a library of rider clauses.
//
// HONESTY RULES FOR THIS FILE
// - No form's text is reproduced. BIMCO, ASBA and oil-major forms are copyright; the user pastes their own clause.
// - Positions are written as "typical": what the printed form commonly provides, from general knowledge of the form.
//   Each is shown to the user as "typical: confirm against your copy". Clause numbers are left for the user to fill.
// - Where a form leaves a point to its box, recap or rider, the seed says so (value null) instead of guessing.

/** What each topic decides. kind 'term' sets a term of the case; 'start' decides commencement; 'category' decides
 *  how SOF rows of that category are treated. */
export const TOPICS = {
  exceptions: { label: 'Which days count', kind: 'term', options: ['shinc', 'shex', 'sshex', 'fhex', 'eiu', 'uu'] },
  commencement: { label: 'When laytime starts after a valid NOR', kind: 'start', options: ['notice:6', 'notice:12', 'notice:24', 'noon'] },
  earlier: { label: 'Work begun before laytime starts', kind: 'start', options: ['counts-from-start', 'not-counted'] },
  onceOnDem: { label: 'Once on demurrage, always on demurrage', kind: 'term', options: ['yes', 'no'] },
  despatch: { label: 'Despatch', kind: 'term', options: ['half', 'none'] },
  waiting: { label: 'Waiting for a berth after NOR', kind: 'category', options: ['counts', 'excluded'] },
  shifting: { label: 'Shifting from anchorage to berth', kind: 'category', options: ['counts', 'excluded', 'excluded-always'] },
  weather: { label: 'Bad weather stopping work', kind: 'category', options: ['counts', 'excluded', 'excluded-always', 'half'] },
  surveys: { label: 'Draft surveys, hold inspection, clearance', kind: 'category', options: ['counts', 'excluded', 'excluded-always'] },
  hatches: { label: 'Opening and closing hatches', kind: 'category', options: ['counts', 'excluded'] },
  vessel: { label: 'Vessel at fault, ship\'s gear breakdown', kind: 'category', options: ['counts', 'excluded', 'excluded-always'] },
  cranes: { label: 'Some of the ship\'s cranes down', kind: 'category', options: ['counts', 'prorata', 'excluded-always'] },
  strikes: { label: 'Strikes, stoppages by labour', kind: 'category', options: ['counts', 'excluded', 'excluded-always', 'half'] },
  shore: { label: 'Shore breakdown, cargo not ready', kind: 'category', options: ['counts', 'excluded', 'half'] },
};

export const VALUE_LABEL = {
  shinc: 'SHINC: every day counts', shex: 'SHEX: Sundays and holidays excluded', sshex: 'SSHEX: Saturdays, Sundays and holidays excluded', fhex: 'FHEX: Fridays and holidays excluded',
  eiu: 'SHEX even if used', uu: 'SHEX unless used (worked time counts)',
  'notice:6': '6 hours after NOR', 'notice:12': '12 hours after NOR', 'notice:24': '24 hours after NOR',
  noon: 'NOR by noon: 13:00 same day; after noon: 06:00 next working day',
  'counts-from-start': 'Counts from when work began', 'not-counted': 'Not counted until laytime starts',
  yes: 'Yes', no: 'No: exceptions still apply on demurrage',
  half: 'Half counts (half rate on demurrage)', none: 'No despatch',
  counts: 'Counts', excluded: 'Does not count (counts once on demurrage)', 'excluded-always': 'Does not count, even on demurrage',
  prorata: 'Counts pro rata to cranes working',
};
/** A value's label in its topic: "half" means half the demurrage rate for despatch, half the time for a category. */
export const labelOf = (topic, v) => (topic === 'despatch' && v === 'half' ? 'Half the demurrage rate' : VALUE_LABEL[v] ?? v);

/** Printed forms in common use for voyage charters. `fits`: the trades it is used in. `p`: typical positions. */
export const FORMS = [
  { id: 'gencon94', name: 'GENCON 1994', by: 'BIMCO', fits: 'General dry cargo, many bulk trades',
    p: { commencement: 'noon', waiting: 'counts', shifting: 'excluded', onceOnDem: 'yes', despatch: 'none', exceptions: null, weather: null },
    note: 'The days that count, the rates and any weather terms come from the boxes or the recap. The printed form provides no despatch: check whether your recap or rider adds it.' },
  { id: 'gencon22', name: 'GENCON 2022', by: 'BIMCO', fits: 'General dry cargo',
    p: { commencement: null, waiting: 'counts', onceOnDem: 'yes', exceptions: null },
    note: 'A revised edition with restructured laytime terms. Paste the laytime and NOR clauses from your copy; the seed asserts little beyond the general position.' },
  { id: 'amwelsh93', name: 'AMWELSH 93', by: 'BIMCO / ASBA', fits: 'Coal',
    p: { commencement: null, waiting: 'counts', onceOnDem: 'yes', exceptions: null, weather: 'excluded' },
    note: 'Laytime is commonly expressed in weather working days. NOR office-hours and commencement terms: paste from your copy.' },
  { id: 'polcoalvoy', name: 'POLCOALVOY', by: 'BIMCO', fits: 'Coal from Poland',
    p: { onceOnDem: 'yes', exceptions: null },
    note: 'Paste the laytime, NOR and weather clauses. Seed asserts only the general demurrage rule.' },
  { id: 'norgrain89', name: 'NORGRAIN 89', by: 'ASBA', fits: 'Grain from North America',
    p: { onceOnDem: 'yes', exceptions: null, weather: 'excluded' },
    note: 'Detailed NOR and inspection terms (grain inspection, readiness of holds). Paste them: they often decide validity of the NOR.' },
  { id: 'synacomex', name: 'SYNACOMEX 2000', by: 'BIMCO', fits: 'Grain from the Continent',
    p: { onceOnDem: 'yes', exceptions: null },
    note: 'Paste the laytime and NOR clauses.' },
  { id: 'cementvoy', name: 'CEMENTVOY', by: 'BIMCO', fits: 'Cement',
    p: { onceOnDem: 'yes', exceptions: null },
    note: 'Paste the laytime and NOR clauses.' },
  { id: 'asbatankvoy', name: 'ASBATANKVOY', by: 'ASBA', fits: 'Tankers',
    p: { commencement: 'notice:6', exceptions: 'shinc', shifting: 'excluded', onceOnDem: 'yes', despatch: 'none', strikes: 'half', shore: 'half', weather: 'half' },
    note: 'Laytime is usually a total of running hours for loading and discharging together: enter it as allowed hours. Half rate for certain causes (fire, explosion, storm, strikes, breakdown of shore plant) is typical: check the exact list in your copy.' },
  { id: 'bpvoy', name: 'BPVOY 4 / 5', by: 'BP', fits: 'Tankers',
    p: { commencement: 'notice:6', exceptions: 'shinc', onceOnDem: 'yes', despatch: 'none' },
    note: 'Oil-major form with detailed NOR and half-rate terms. Paste them.' },
  { id: 'shellvoy6', name: 'SHELLVOY 6', by: 'Shell', fits: 'Tankers',
    p: { commencement: 'notice:6', exceptions: 'shinc', onceOnDem: 'yes', despatch: 'none' },
    note: 'Oil-major form with detailed NOR, shifting and half-rate terms. Paste them.' },
  { id: 'fixturenote', name: 'Fixture note or recap only', by: 'Own wording', fits: 'Coastal and short-form fixtures',
    p: { onceOnDem: 'yes' },
    note: 'Everything comes from the fixture note itself. Watch for two lines of the same note that say different things: mark them both and treat the point as disputed.' },
  { id: 'own', name: 'Another form', by: '', fits: '',
    p: { onceOnDem: 'yes' },
    note: 'Name the form and paste each clause that bears on laytime.' },
];

/** Rider clauses that commonly change the printed form's laytime terms. Our own short wording, not a clause text. */
export const RIDERS = [
  { id: 'tt12', name: 'Turn time 12 hours after NOR', set: { commencement: 'notice:12' } },
  { id: 'tt6', name: 'Turn time 6 hours after NOR', set: { commencement: 'notice:6' } },
  { id: 'noon', name: 'NOR by noon / after noon rule', set: { commencement: 'noon' } },
  { id: 'unless', name: 'Unless sooner commenced, actual time used to count', set: { earlier: 'counts-from-start' } },
  { id: 'shex', name: 'Sundays and holidays excepted', set: { exceptions: 'shex' } },
  { id: 'shexuu', name: 'SHEX unless used', set: { exceptions: 'uu' } },
  { id: 'shexeiu', name: 'SHEX even if used', set: { exceptions: 'eiu' } },
  { id: 'sshex', name: 'Saturdays, Sundays and holidays excepted', set: { exceptions: 'sshex' } },
  { id: 'fhex', name: 'Fridays and holidays excepted', set: { exceptions: 'fhex' } },
  { id: 'shinc', name: 'Sundays and holidays included', set: { exceptions: 'shinc' } },
  { id: 'wwd', name: 'Weather working days: bad weather does not count', set: { weather: 'excluded' } },
  { id: 'wxcounts', name: 'All bad weather delays to count', set: { weather: 'counts' } },
  { id: 'wxalways', name: 'Bad weather not to count, even on demurrage', set: { weather: 'excluded-always' } },
  { id: 'shift', name: 'Shifting anchorage to berth not to count', set: { shifting: 'excluded' } },
  { id: 'shiftalways', name: 'Shifting not to count, even on demurrage', set: { shifting: 'excluded-always' } },
  { id: 'wait', name: 'Time waiting for berth to count', set: { waiting: 'counts' } },
  { id: 'survey', name: 'Draft surveys and hold inspection not to count', set: { surveys: 'excluded' } },
  { id: 'surveyalways', name: 'Surveys and inspection not to count, even on demurrage', set: { surveys: 'excluded-always' } },
  { id: 'hatches', name: 'Opening and closing hatches not to count', set: { hatches: 'excluded' } },
  { id: 'vessel', name: 'Delays caused by vessel or its equipment not to count, even on demurrage', set: { vessel: 'excluded-always' } },
  { id: 'cranes', name: 'Crane breakdown: laytime pro rata to cranes working', set: { cranes: 'prorata' } },
  { id: 'strikes', name: 'Strikes not to count', set: { strikes: 'excluded' } },
  { id: 'oodaod', name: 'Once on demurrage, always on demurrage', set: { onceOnDem: 'yes' } },
  { id: 'notood', name: 'Exceptions apply also on demurrage', set: { onceOnDem: 'no' } },
  { id: 'dhd', name: 'Despatch at half the demurrage rate', set: { despatch: 'half' } },
  { id: 'nodesp', name: 'No despatch', set: { despatch: 'none' } },
];

export const CATEGORIES = [
  ['waiting', 'Waiting for berth'], ['shifting', 'Shifting'], ['weather', 'Bad weather'], ['surveys', 'Survey / inspection / clearance'],
  ['hatches', 'Hatches'], ['vessel', 'Vessel fault / ship\'s gear'], ['cranes', 'Cranes down (pro rata)'], ['strikes', 'Strike'],
  ['shore', 'Shore breakdown / cargo not ready'], ['agreed', 'Agreed: does not count'], ['worked', 'Worked on an excepted day (UU)'],
  ['other', 'Other (counts unless disputed)'],
];

export const SIDES = ['owners', 'charterers', 'middle', 'conditional'];
