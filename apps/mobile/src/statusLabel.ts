/**
 * The ONLY place user-facing status wording is produced.
 *
 * Both app surfaces render status text through these functions rather than
 * writing strings inline, so the domain rules are enforced in one auditable
 * place instead of being re-litigated on every screen.
 *
 * ## The rules being enforced
 *
 * AGENTS.md: "Screening is not laboratory confirmation or potability. Never
 * produce a model-generated diagnosis or remediation instruction."
 * data-model.md: "'no_flag' means the selected tested parameter did not
 * trigger that protocol's review rule, not safe water" and "an uncalibrated
 * model must not emit a trusted percentage".
 *
 * Practically that means three things this module guarantees:
 *
 *  1. No screening outcome is ever worded as safe / potable / drinkable /
 *     clean. `BANNED_WORDS` is asserted against every string this module can
 *     emit, in tests/status-label.test.ts.
 *  2. Screening, human observation and laboratory result are three separate
 *     provenance channels and are never merged into one "result".
 *  3. No confidence percentage is emitted for a model that has not been
 *     approved. There is currently no approved model at all, so the assisted
 *     path reports that plainly rather than showing a number.
 */

/** Words that may never appear in a status string this module produces. */
export const BANNED_WORDS = [
  'safe',
  'unsafe',
  'potable',
  'drinkable',
  'clean',
  'pure',
  'contaminated',
  'harmless',
  'fit to drink',
  'ok to drink',
] as const;

// --- screening (machine / assisted) ---------------------------------------

/** Ordinal screening flag from the protocol. NEVER a water verdict. */
export type IndicativeFlag = 'no_flag' | 'review' | 'uncertain' | 'invalid';

export interface ScreeningPresentation {
  title: string;
  detail: string;
  tone: 'ok' | 'watch' | 'alert' | 'unknown';
}

export function screeningPresentation(flag: IndicativeFlag): ScreeningPresentation {
  switch (flag) {
    case 'no_flag':
      return {
        // Deliberately NOT "safe". This says only that the protocol's review
        // rule was not triggered for the one parameter tested.
        title: 'No review triggered',
        detail:
          'This screening did not trigger the kit’s review rule for the tested parameter. It is not a laboratory test and not a drinking-water decision.',
        tone: 'ok',
      };
    case 'review':
      return {
        title: 'Needs supervisor review',
        detail:
          'This screening triggered the kit’s review rule. A supervisor will look at it. This is not a diagnosis.',
        tone: 'watch',
      };
    case 'uncertain':
      return {
        title: 'Uncertain — cannot interpret',
        detail:
          'The reading could not be interpreted with confidence. Record a manual reading or test again.',
        tone: 'unknown',
      };
    case 'invalid':
      return {
        title: 'Invalid — not usable',
        detail:
          'Timing, kit or capture conditions make this test unusable. A fresh test is required.',
        tone: 'alert',
      };
  }
}

/**
 * What the assisted (model) path may currently display.
 *
 * `model.enabled` is false for every protocol until T27 approves a model, and
 * no model exists. Rather than render an empty confidence meter or invent a
 * percentage, the UI states the situation.
 */
export function assistedAvailability(modelEnabled: boolean): {
  available: boolean;
  label: string;
  detail: string;
} {
  if (!modelEnabled) {
    return {
      available: false,
      label: 'Automatic reading not available',
      detail:
        'No analysis model has been approved for this kit, so the app cannot suggest a reading. Record what you see and a supervisor will review it.',
    };
  }
  return {
    available: true,
    label: 'Machine suggestion',
    detail: 'A suggestion from the approved model. A person still decides.',
  };
}

// --- capture quality (T10 reason codes) -----------------------------------

const QUALITY_TEXT: Record<string, string> = {
  BLUR_SUSPECTED: 'Photo looks out of focus',
  CLIPPING_EXCESSIVE: 'Parts of the photo are over- or under-exposed',
  GLARE_EXCESSIVE: 'Too much glare on the strip',
  ROI_TOO_SMALL: 'Selected region is too small to read',
  REFERENCE_CARD_NOT_DETECTED: 'Reference card not found in the photo',
  REFERENCE_CARD_UNREADABLE: 'Reference card found but not readable',
  THRESHOLD_UNSET: 'Some quality checks are not yet calibrated',
};

export function qualityReasonText(code: string): string {
  return QUALITY_TEXT[code] ?? 'Capture quality could not be confirmed';
}

// --- laboratory results ----------------------------------------------------

/**
 * A verified laboratory parameter. This is the ONE channel allowed to carry
 * precise numeric values, because a laboratory actually measured them and a
 * `lab_reviewer` verified the report. It is still reported as "as tested on
 * <date>", never as a standing property of the water.
 */
export interface LabParameter {
  name: string;
  value: string;
  unit: string | null;
  /** The published limit this is compared against, e.g. BIS 10500. */
  limitText: string;
  withinLimit: boolean | null;
}

export function labParameterTone(p: LabParameter): 'ok' | 'watch' | 'unknown' {
  if (p.withinLimit === null) return 'unknown';
  return p.withinLimit ? 'ok' : 'watch';
}

/**
 * Summary wording for a verified lab report.
 *
 * Even when every parameter is within limits this does NOT say the water is
 * safe. It states what was measured, against which standard, on which date —
 * which is a fact — and stops there.
 */
export function labSummary(
  allWithinLimits: boolean | null,
  testedOn: string,
  labName: string,
): { title: string; detail: string; tone: 'ok' | 'watch' | 'unknown' } {
  if (allWithinLimits === null) {
    return {
      title: 'No verified laboratory result',
      detail: 'No laboratory report for this source has been verified yet.',
      tone: 'unknown',
    };
  }
  if (allWithinLimits) {
    return {
      title: 'All tested parameters within limits',
      detail: `Every parameter tested by ${labName} on ${testedOn} was within the published BIS 10500 limits. Only the parameters listed were tested.`,
      tone: 'ok',
    };
  }
  return {
    title: 'One or more parameters outside limits',
    detail: `A parameter tested by ${labName} on ${testedOn} was outside the published BIS 10500 limits. A supervisor is following this up.`,
    tone: 'watch',
  };
}

/**
 * Freshness of the record being shown. Reused from T07's reasoning: the
 * community must never read an old record as a current status.
 */
export function recordAgeLabel(testedOnIso: string, nowMs: number): string {
  const t = Date.parse(testedOnIso);
  if (Number.isNaN(t)) return 'Date of this record is unknown';
  const days = Math.floor((nowMs - t) / 86_400_000);
  if (days < 0) return 'Record date is in the future — device clock may be wrong';
  if (days === 0) return 'Recorded today';
  if (days === 1) return 'Recorded yesterday';
  return `Recorded ${days} days ago`;
}
