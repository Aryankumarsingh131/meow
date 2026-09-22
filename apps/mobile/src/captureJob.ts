/**
 * T09: capture job lifecycle and manual ROI geometry.
 *
 * The whole point of this module is one guarantee, from
 * jalsakshi-blueprint/docs/product/user-journeys.md J02:
 *
 *   "Retaking creates a new capture job; cancelled/late model output cannot
 *    overwrite it."
 *
 * Image analysis is asynchronous. A worker who sees a bad frame will retake
 * immediately, while the previous frame is still being processed. If the old
 * job's result is allowed to land, the screen shows an analysis of a photo the
 * worker already rejected - attached to the retake they are looking at. That
 * is a provenance failure, not a cosmetic race.
 *
 * ## How the guarantee is enforced
 *
 * State transitions are pure functions over an explicit state value, not
 * methods on a mutable runner. A late result cannot "win" by arriving,
 * because applying it requires passing the current state, and `settleJob`
 * refuses any job id that is not the active one.
 *
 * `settleJob` returns a typed **disposition** rather than silently ignoring a
 * stale result. A caller that drops a result must be able to say why it was
 * dropped - AGENTS.md forbids collapsing distinct outcomes into one boolean.
 *
 * ## Bounded by construction
 *
 * ui-ux-specification.md S04 requires "busy capture cannot queue unlimited
 * jobs". There is no queue here at all: at most one job is active, and
 * starting a new one supersedes the old. That is stronger than a bounded
 * queue and needs no eviction policy.
 *
 * ## What this module does NOT do
 *
 * - No reference-card *detection*. The native bridge
 *   (`modules/capture-native`, T04, role B) takes ROI corners as input and
 *   does not find them. Automatic detection and quality scoring are T10.
 *   T09 handles the case where corners are absent or rejected, which is what
 *   "missing card prompts" and manual ROI are for.
 * - No bin, reading, concentration or water-quality judgement of any kind.
 */

import type { Point } from '../../../modules/capture-native/index';

/** Why a capture attempt failed. Each maps to a distinct S04 edge state. */
export type CaptureFailureReason =
  /** OS camera permission refused. */
  | 'permission_denied'
  /** No usable camera (hardware missing, in use, or unsupported device). */
  | 'camera_unavailable'
  /** Protocol requires a reference card and none was located. */
  | 'reference_card_missing'
  /** The ROI corners are unusable (off-image, degenerate, wrong count). */
  | 'roi_invalid'
  /** The captured file could not be decoded. */
  | 'decode_error'
  /** The native analysis bridge is unavailable on this build/device. */
  | 'native_unavailable';

/**
 * Whether the worker can fix this themselves and try again.
 *
 * `permission_denied` is recoverable: the OS prompt can be re-requested, or
 * the worker can be sent to settings. That is acceptance criterion 1 -
 * a denied permission must not be a dead end.
 *
 * Nothing here is ever a dead end overall: every failure leaves manual entry
 * open (J02), which is a separate axis from whether capture itself can be
 * retried.
 */
export const RECOVERABLE_FAILURES: ReadonlySet<CaptureFailureReason> = new Set([
  'permission_denied',
  'reference_card_missing',
  'roi_invalid',
  'decode_error',
]);

export function isRecoverable(reason: CaptureFailureReason): boolean {
  return RECOVERABLE_FAILURES.has(reason);
}

/**
 * The one-line prompt shown for each failure. Every string names an action
 * the worker can take; none of them says anything about the water.
 */
export const FAILURE_PROMPT: Record<CaptureFailureReason, string> = {
  permission_denied:
    'Camera access is off. Turn it on to take a photo, or enter the reading manually.',
  camera_unavailable:
    'This device’s camera is not available. Enter the reading manually.',
  reference_card_missing:
    'The reference card was not found in the photo. Place the card beside the strip and retake, or mark the region by hand.',
  roi_invalid:
    'The marked region is not usable. Adjust the four corners so they sit around the strip.',
  decode_error: 'That photo could not be read. Please retake it.',
  native_unavailable:
    'Automatic reading is not available on this device. Enter the reading manually.',
};

export interface CaptureRequest {
  /** Source being tested. Carried so a settled job can be matched to it. */
  sourceId: string;
  protocolId: string;
  protocolVersion: number;
  /** T08 attempt this capture belongs to. */
  attemptId: string;
  /** Protocol quality policy: does this kit require a reference card? */
  requireReferenceCard: boolean;
}

export interface CaptureJob {
  jobId: string;
  /** Monotonic within a session. Makes "older" objectively checkable. */
  seq: number;
  request: CaptureRequest;
  startedAtMs: number;
}

/** Result of a job, produced by the caller's async analysis. */
export type CaptureOutcome =
  | { kind: 'analysed'; features: unknown; corners: readonly Point[]; orientation: number }
  | { kind: 'failed'; reason: CaptureFailureReason };

export type SettledJob =
  | { status: 'succeeded'; job: CaptureJob; features: unknown; corners: readonly Point[]; orientation: number }
  | { status: 'failed'; job: CaptureJob; reason: CaptureFailureReason; recoverable: boolean }
  | { status: 'cancelled'; job: CaptureJob }
  | { status: 'superseded'; job: CaptureJob; supersededBy: string };

export interface CaptureState {
  /** At most one. There is deliberately no queue. */
  active: CaptureJob | null;
  /** The most recent settled job, whatever its ending. */
  last: SettledJob | null;
  /** Every job that ended without a result, newest first. Retained as
   *  evidence: a superseded or cancelled attempt must stay visible rather
   *  than being erased (AGENTS.md - never drop records to make a path pass). */
  discarded: readonly SettledJob[];
  nextSeq: number;
}

export const initialCaptureState: CaptureState = {
  active: null,
  last: null,
  discarded: [],
  nextSeq: 1,
};

/** Why a settle attempt did or did not take effect. */
export type SettleDisposition =
  | 'applied'
  /** The job was replaced by a retake before its result arrived. */
  | 'discarded_superseded'
  /** The worker cancelled this job before its result arrived. */
  | 'discarded_cancelled'
  /** No such job in this session at all. */
  | 'discarded_unknown';

/**
 * Begin a capture. Any in-flight job is superseded immediately - not on its
 * result arriving - so the window in which a stale result could be mistaken
 * for current is zero.
 */
export function startJob(
  state: CaptureState,
  jobId: string,
  request: CaptureRequest,
  nowMs: number,
): { state: CaptureState; job: CaptureJob } {
  if (state.active && state.active.jobId === jobId) {
    throw new Error('A retake must use a new jobId; reusing one hides the superseded attempt.');
  }

  const job: CaptureJob = { jobId, seq: state.nextSeq, request, startedAtMs: nowMs };

  const superseded: SettledJob[] = state.active
    ? [{ status: 'superseded', job: state.active, supersededBy: jobId }]
    : [];

  return {
    state: {
      active: job,
      // `last` deliberately keeps the superseded record rather than the old
      // success: the screen must not keep showing a result for a photo that
      // has just been retaken.
      last: superseded[0] ?? state.last,
      discarded: [...superseded, ...state.discarded],
      nextSeq: state.nextSeq + 1,
    },
    job,
  };
}

/** Cancel the active job. A later result for it will be refused. */
export function cancelJob(state: CaptureState, jobId: string): CaptureState {
  if (!state.active || state.active.jobId !== jobId) return state;
  const cancelled: SettledJob = { status: 'cancelled', job: state.active };
  return {
    ...state,
    active: null,
    last: cancelled,
    discarded: [cancelled, ...state.discarded],
  };
}

/**
 * Apply an outcome to a job.
 *
 * This is the guarantee. A result is applied ONLY if its job is still the
 * active one. A retake or a cancel between start and settle means the result
 * is refused, and the disposition says which.
 */
export function settleJob(
  state: CaptureState,
  jobId: string,
  outcome: CaptureOutcome,
): { state: CaptureState; disposition: SettleDisposition } {
  if (!state.active || state.active.jobId !== jobId) {
    // Work out *why* it is not active, so the caller can explain it.
    const priorEnding = state.discarded.find((entry) => entry.job.jobId === jobId);
    const disposition: SettleDisposition =
      priorEnding?.status === 'cancelled'
        ? 'discarded_cancelled'
        : priorEnding?.status === 'superseded'
          ? 'discarded_superseded'
          : priorEnding
            ? 'discarded_superseded'
            : 'discarded_unknown';
    // State is returned unchanged: a stale result changes nothing at all.
    return { state, disposition };
  }

  const job = state.active;
  const settled: SettledJob =
    outcome.kind === 'analysed'
      ? {
          status: 'succeeded',
          job,
          features: outcome.features,
          corners: outcome.corners,
          orientation: outcome.orientation,
        }
      : {
          status: 'failed',
          job,
          reason: outcome.reason,
          recoverable: isRecoverable(outcome.reason),
        };

  return {
    state: { ...state, active: null, last: settled },
    disposition: 'applied',
  };
}

/** Whether a fresh capture may be started. Always true - a retake is never
 *  blocked by an in-flight job, it supersedes it. Exported so the screen has
 *  one obvious place to ask, rather than re-deriving the rule. */
export function canStartCapture(_state: CaptureState): true {
  return true;
}

/** Manual entry is available in every state, including success. J02 requires
 *  the escape hatch to exist whenever capture fails, and a worker may always
 *  override what the machine suggested. */
export function manualEntryAvailable(_state: CaptureState): true {
  return true;
}

// --- manual ROI geometry ---------------------------------------------------

/**
 * Corners are ordered top-left, top-right, bottom-right, bottom-left in the
 * UPRIGHT (EXIF orientation-1) frame, matching what
 * `modules/capture-native` expects. `docs/feature-schema.md` is authoritative.
 */
export type RoiCorners = readonly [Point, Point, Point, Point];

export type RoiValidation =
  | { valid: true; corners: RoiCorners }
  | { valid: false; reason: 'wrong_count' | 'out_of_bounds' | 'degenerate' };

/** Minimum ROI area in square pixels of the upright image.
 *
 *  An engineering floor, not a domain threshold: below a few pixels the
 *  perspective sampler has nothing to average and any median is noise. The
 *  real quality thresholds (blur, glare, min_roi_pixels) belong to the
 *  protocol's `quality_policy` and are fitted in T10 - deliberately NOT
 *  guessed here. */
export const MIN_ROI_AREA_PX = 16;

/** Shoelace area of the quad, sign-independent. */
function quadArea(corners: RoiCorners): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Validate user-adjusted corners against the upright image bounds.
 *
 * Rejecting rather than clamping is deliberate: silently moving a worker's
 * corner inside the frame would analyse a region they did not choose and
 * report it as theirs.
 */
export function validateRoi(
  corners: readonly Point[],
  uprightWidth: number,
  uprightHeight: number,
): RoiValidation {
  if (corners.length !== 4) return { valid: false, reason: 'wrong_count' };

  for (const { x, y } of corners) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { valid: false, reason: 'out_of_bounds' };
    }
    if (x < 0 || y < 0 || x > uprightWidth || y > uprightHeight) {
      return { valid: false, reason: 'out_of_bounds' };
    }
  }

  const quad = corners as RoiCorners;
  if (quadArea(quad) < MIN_ROI_AREA_PX) return { valid: false, reason: 'degenerate' };

  return { valid: true, corners: quad };
}

/**
 * Map a point from displayed-image coordinates into the upright frame.
 *
 * The preview shows the photo as stored; the worker drags corners on *that*.
 * The native pipeline works on the EXIF-corrected upright image. Without this
 * mapping, a ROI drawn on a rotated photo analyses the wrong region - which
 * is exactly the "rotated photos normalize correctly" half of AC-003.
 *
 * `storedWidth`/`storedHeight` are the pre-correction dimensions. Orientations
 * 5-8 transpose the axes, so the upright frame's width is the stored height.
 * Cases mirror `correctOrientation` in modules/capture-native/index.ts.
 */
export function toUprightPoint(
  point: Point,
  orientation: number,
  storedWidth: number,
  storedHeight: number,
): Point {
  const { x, y } = point;
  const w = storedWidth;
  const h = storedHeight;
  switch (orientation) {
    case 2:
      return { x: w - x, y };
    case 3:
      return { x: w - x, y: h - y };
    case 4:
      return { x, y: h - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: h - y, y: x };
    case 7:
      return { x: h - y, y: w - x };
    case 8:
      return { x: y, y: w - x };
    default:
      return { x, y };
  }
}

/** Upright frame dimensions for a stored image at `orientation`. */
export function uprightSize(
  orientation: number,
  storedWidth: number,
  storedHeight: number,
): { width: number; height: number } {
  const transposed = orientation >= 5 && orientation <= 8;
  return transposed
    ? { width: storedHeight, height: storedWidth }
    : { width: storedWidth, height: storedHeight };
}

/**
 * Default ROI when the worker must mark the region by hand: a centred square
 * covering half the frame, which they then drag.
 *
 * A starting shape, never an assumed answer - `reference_card_missing` is
 * still reported, and nothing is analysed until the worker confirms.
 */
export function defaultManualRoi(uprightWidth: number, uprightHeight: number): RoiCorners {
  const side = Math.min(uprightWidth, uprightHeight) / 2;
  const cx = uprightWidth / 2;
  const cy = uprightHeight / 2;
  const half = side / 2;
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}
