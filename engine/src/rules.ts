// Laytime Calculation Rules Engine — implements maritime laytime commencement,
// exclusion, demurrage/despatch, time-bar, and reversible laytime logic.

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface ExclusionDetail {
// @rule:CHRT-001 — charter party management
  startTime: Date;
  endTime: Date;
  reason: string;
  hours: number;
}

export interface PortHoliday {
  date: Date;
  affectsLaytime: boolean;
}

export interface PortWorkingHours {
  dayOfWeek: number;   // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: string;   // "HH:MM" 24-hour format
  endTime: string;     // "HH:MM" 24-hour format
  isWorking: boolean;
}

export interface LaytimeResultParams {
  allowedHours: number;
  grossHours: number;
  excludedHours: number;
  demurrageRate: number | null;
  despatchRate: number | null;
}

export interface LaytimeResult {
  usedHours: number;
  result: string;
  amountDue: number | null; // null: the rate that applies (demurrage or despatch) is not in the record (CHRT-008)
}

export interface ReversibleLaytimeEntry {
  allowedHours: number;
  usedHours: number;
  demurrageRate: number | null;
  despatchRate: number | null;
}

export interface ReversibleLaytimeResult {
  totalAllowed: number;
  totalUsed: number;
  result: string;
  amountDue: number | null; // null: the rate that applies is not in the record (CHRT-008)
}

// ─── Commencement Time ───────────────────────────────────────────────────────

/**
 * Calculate the time at which laytime commences.
 *
 * Supported rules:
 *   - wibon  — Whether In Berth Or Not
 *   - wipon  — Whether In Port Or Not
 *   - wifpon — Whether In Free Pratique Or Not
 *   - wccon  — Whether Customs Cleared Or Not
 *
 * In all cases laytime commences noticeTimeHours after NOR is tendered.
 * The rule name is retained for charterparty documentation purposes.
 */
export function calculateCommencementTime(
  norTendered: Date,
  rule: string,
  noticeTimeHours: number,
): Date {
  const validRules = ['wibon', 'wipon', 'wifpon', 'wccon'];
  const normalised = rule.toLowerCase().trim();

  if (!validRules.includes(normalised)) {
    throw new Error(
      `Unknown commencement rule "${rule}". Expected one of: ${validRules.join(', ')}`,
    );
  }

  const commencementMs = norTendered.getTime() + noticeTimeHours * 60 * 60 * 1000;
  return new Date(commencementMs);
}

// ─── Helper: Date Comparison ─────────────────────────────────────────────────

/** Check whether two dates fall on the same calendar day (UTC). */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// ─── Day-of-Week Helpers ─────────────────────────────────────────────────────

/** Returns true when the given date falls on a Sunday (UTC). */
export function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

/** Returns true when the given date falls on a Friday (UTC). */
export function isFriday(date: Date): boolean {
  return date.getUTCDay() === 5;
}

// ─── Holiday Check ───────────────────────────────────────────────────────────

/** Returns true when the date falls on a holiday that affects laytime. */
export function isHoliday(
  date: Date,
  holidays: PortHoliday[],
): boolean {
  return holidays.some(
    (h) => h.affectsLaytime && isSameDay(date, h.date),
  );
}

// ─── Excluded Hours Calculation ──────────────────────────────────────────────

/**
 * Walk hour-by-hour from commencedAt to completedAt and apply the exclusion
 * rule to determine how many hours should be excluded from laytime.
 *
 * Exception rules:
 *   - shinc — Sundays and Holidays Included (nothing excluded)
 *   - shex  — Sundays and Holidays Excepted
 *   - fhex  — Fridays and Holidays Excepted
 *   - eiu   — Even If Used (Sundays/Holidays don't count even if operations continue)
 *   - uu    — Unless Used (Sundays/Holidays count only if cargo operations are performed;
 *             since we cannot detect "used" at the rules level, we conservatively exclude)
 */
export function calculateExcludedHours(
  commencedAt: Date,
  completedAt: Date,
  exceptionRule: string,
  portHolidays: PortHoliday[],
  _portWorkingHours?: PortWorkingHours[],
): { excludedHours: number; details: ExclusionDetail[] } {
  const rule = exceptionRule.toLowerCase().trim();
  const details: ExclusionDetail[] = [];

  // SHINC — nothing is ever excluded
  if (rule === 'shinc') {
    return { excludedHours: 0, details };
  }

  const startMs = commencedAt.getTime();
  const endMs = completedAt.getTime();
  const oneHourMs = 60 * 60 * 1000;

  let excludedHours = 0;
  let currentExclusion: { start: Date; reason: string; hours: number } | null = null;

  for (let ms = startMs; ms < endMs; ms += oneHourMs) {
    const hourStart = new Date(ms);
    const hourEnd = new Date(Math.min(ms + oneHourMs, endMs));
    const fractionHour = (hourEnd.getTime() - hourStart.getTime()) / oneHourMs;

    const excluded = isHourExcluded(hourStart, rule, portHolidays);

    if (excluded) {
      const reason = buildExclusionReason(hourStart, rule, portHolidays);

      if (currentExclusion && currentExclusion.reason === reason) {
        // Extend the current exclusion block
        currentExclusion.hours += fractionHour;
      } else {
        // Flush previous block
        if (currentExclusion) {
          details.push({
            startTime: currentExclusion.start,
            endTime: hourStart,
            reason: currentExclusion.reason,
            hours: currentExclusion.hours,
          });
        }
        currentExclusion = { start: hourStart, reason, hours: fractionHour };
      }

      excludedHours += fractionHour;
    } else {
      // Flush any open exclusion block
      if (currentExclusion) {
        details.push({
          startTime: currentExclusion.start,
          endTime: hourStart,
          reason: currentExclusion.reason,
          hours: currentExclusion.hours,
        });
        currentExclusion = null;
      }
    }
  }

  // Flush final open block
  if (currentExclusion) {
    details.push({
      startTime: currentExclusion.start,
      endTime: completedAt,
      reason: currentExclusion.reason,
      hours: currentExclusion.hours,
    });
  }

  return { excludedHours, details };
}

/**
 * Determine whether a single hour-slot is excluded under the given rule.
 */
function isHourExcluded(
  hourStart: Date,
  rule: string,
  portHolidays: PortHoliday[],
): boolean {
  const onHoliday = isHoliday(hourStart, portHolidays);
  const onSunday = isSunday(hourStart);
  const onFriday = isFriday(hourStart);

  switch (rule) {
    case 'shex':
      return onSunday || onHoliday;

    case 'fhex':
      return onFriday || onHoliday;

    case 'eiu':
      // Even If Used — Sundays/Holidays excluded regardless
      return onSunday || onHoliday;

    case 'uu':
      // Unless Used — Sundays/Holidays excluded (conservative; caller may
      // override individual hours as "used" via statement-of-fact entries)
      return onSunday || onHoliday;

    default:
      throw new Error(
        `Unknown exception rule "${rule}". Expected one of: shinc, shex, fhex, eiu, uu`,
      );
  }
}

/**
 * Build a human-readable reason string for the exclusion.
 */
function buildExclusionReason(
  hourStart: Date,
  rule: string,
  portHolidays: PortHoliday[],
): string {
  const onHoliday = isHoliday(hourStart, portHolidays);
  const onSunday = isSunday(hourStart);
  const onFriday = isFriday(hourStart);

  const parts: string[] = [];

  if (rule === 'fhex') {
    if (onFriday) parts.push('Friday');
    if (onHoliday) parts.push('Holiday');
    return `FHEX — ${parts.join(' & ')} excluded`;
  }

  // shex, eiu, uu all exclude Sundays & Holidays
  if (onSunday) parts.push('Sunday');
  if (onHoliday) parts.push('Holiday');

  const ruleLabel = rule.toUpperCase();
  return `${ruleLabel} — ${parts.join(' & ')} excluded`;
}

// ─── Laytime Result ──────────────────────────────────────────────────────────

/**
 * Calculate the final laytime outcome: demurrage, despatch, or within laytime.
 *
 * - usedHours = grossHours - excludedHours
 * - Rates are per day, so the excess/saving in hours is divided by 24.
 * - A missing rate gives amountDue null, never 0: "no rate in the record" is not "nothing due" (CHRT-008).
 */
export function calculateLaytimeResult(params: LaytimeResultParams): LaytimeResult {
  const { allowedHours, grossHours, excludedHours, demurrageRate, despatchRate } = params;

  const usedHours = grossHours - excludedHours;
  const diff = usedHours - allowedHours;

  if (diff > 0) {
    const amountDue = demurrageRate != null ? (diff / 24) * demurrageRate : null;
    return { usedHours, result: 'on_demurrage', amountDue };
  }

  if (diff < 0) {
    const amountDue = despatchRate != null ? (Math.abs(diff) / 24) * despatchRate : null;
    return { usedHours, result: 'on_despatch', amountDue };
  }

  return { usedHours, result: 'within_laytime', amountDue: 0 };
}

// ─── Time Bar Date ───────────────────────────────────────────────────────────

/**
 * Calculate the time-bar deadline by adding the contractual time-bar
 * period (in days) to the completion date.
 */
export function calculateTimeBarDate(completedAt: Date, timeBarDays: number): Date {
  const ms = completedAt.getTime() + timeBarDays * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

// ─── Reversible Laytime ──────────────────────────────────────────────────────

/**
 * Combine multiple port laytime calculations into a single reversible result.
 *
 * Under a reversible laytime clause the time saved at one port can offset
 * time exceeded at another. All allowed and used hours are summed, then a
 * single demurrage or despatch figure is computed.
 *
 * The demurrage/despatch rate is taken from the first entry that provides one
 * (rates are typically uniform across the voyage under reversible clauses).
 */
export function calculateReversibleLaytime(
  calculations: ReversibleLaytimeEntry[],
): ReversibleLaytimeResult {
  if (calculations.length === 0) {
    return { totalAllowed: 0, totalUsed: 0, result: 'within_laytime', amountDue: 0 };
  }

  const totalAllowed = calculations.reduce((sum, c) => sum + c.allowedHours, 0);
  const totalUsed = calculations.reduce((sum, c) => sum + c.usedHours, 0);

  const diff = totalUsed - totalAllowed;

  // Resolve rates: use the first non-null value found across calculations
  const demurrageRate = calculations.find((c) => c.demurrageRate != null)?.demurrageRate ?? null;
  const despatchRate = calculations.find((c) => c.despatchRate != null)?.despatchRate ?? null;

  if (diff > 0) {
    const amountDue = demurrageRate != null ? (diff / 24) * demurrageRate : null;
    return { totalAllowed, totalUsed, result: 'on_demurrage', amountDue };
  }

  if (diff < 0) {
    const amountDue = despatchRate != null ? (Math.abs(diff) / 24) * despatchRate : null;
    return { totalAllowed, totalUsed, result: 'on_despatch', amountDue };
  }

  return { totalAllowed, totalUsed, result: 'within_laytime', amountDue: 0 };
}
