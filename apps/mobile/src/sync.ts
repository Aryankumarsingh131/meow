/**
 * T15: foreground sync — drain the outbox (T13 push), then follow the ordered
 * change feed (T14 pull).
 *
 * Rules, from api-contracts.md:
 *   - A receipt and the removal of its outbox row commit together. A lost
 *     acknowledgement therefore leaves the row pending; the replay carries the
 *     same event id and payload, and the server answers `duplicate`.
 *   - Retry only transport failures and 408/429/5xx, with jittered
 *     1,2,4,8,16,30,60 s delays persisted on the row. At most eight automatic
 *     attempts per foreground session. Backoff is not deletion.
 *   - Auth errors pause sending for sign-in; no record is touched.
 *   - Validation/conflict needs a person. The record stays on the phone and is
 *     shown as needing attention; it is never silently dropped.
 *   - Apply every pulled page plus its cursor in one transaction. Do not
 *     advance on partial failure. 410 (or a cursor the server refuses) means
 *     re-bootstrap — keeping every pending record.
 *
 * Sync runs only while the app is open (foreground). Nothing here claims that
 * a record is sent while the app is closed.
 */

import type { ApiOutcome, EventReceipt, PushEvent, SyncTransport } from './api';
import { getMeta, setMeta, writeCatalogue, type Sql } from './storage.ts';

export const RETRY_DELAYS_S = [1, 2, 4, 8, 16, 30, 60] as const;
export const MAX_AUTO_ATTEMPTS_PER_SESSION = 8;
/** PushRequest.events max_length (services/api/app/schemas.py). */
export const PUSH_BATCH = 50;
/** Bounds on one sync pass, so a server bug cannot loop the phone forever. */
export const MAX_PULL_PAGES = 50;
export const MAX_BOOTSTRAP_PAGES = 50;

export interface SyncDeps {
  sql: Sql;
  transport: SyncTransport;
  /** Signed-in account subject. Only this account's records are sent. */
  owner: string;
  deviceId: string;
  now(): number;
  random(): number;
}

/** One per foreground session (app opened / resumed). */
export interface SyncSession {
  autoAttempts: number;
}

export type StepResult = 'done' | 'nothing_due' | 'offline' | 'auth_paused' | 'forbidden' | 'server_error' | 'session_limit';

export interface SyncResult {
  push: StepResult;
  pull: StepResult | 'skipped';
  accepted: number;
  needsAttention: number;
  pulled: number;
}

interface OutboxRow {
  event_id: string;
  sample_id: string;
  payload_json: string;
  attempt: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

function due(sql: Sql, owner: string, nowIso: string, manual: boolean): OutboxRow[] {
  return sql.all<OutboxRow>(
    `SELECT o.event_id, o.sample_id, o.payload_json, o.attempt
       FROM outbox o JOIN local_samples s ON s.id = o.sample_id
      WHERE s.owner = ? AND (? = 1 OR o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
      ORDER BY s.saved_at, o.event_id`,
    [owner, manual ? 1 : 0, nowIso],
  );
}

function toEvent(row: OutboxRow): PushEvent {
  const payload = JSON.parse(row.payload_json) as { supersedes_id?: unknown };
  return {
    event_id: row.event_id,
    kind: payload.supersedes_id ? 'sample.correct' : 'sample.create',
    schema_version: 1,
    payload,
  };
}

function schedule(sql: Sql, rows: readonly OutboxRow[], deps: SyncDeps): void {
  for (const row of rows) {
    const delayS = RETRY_DELAYS_S[Math.min(row.attempt, RETRY_DELAYS_S.length - 1)];
    // Jitter in [0.5, 1.0) of the delay, so phones that lost signal together
    // do not reconnect in lockstep.
    const next = deps.now() + delayS * 1000 * (0.5 + deps.random() * 0.5);
    sql.run('UPDATE outbox SET attempt = attempt + 1, next_attempt_at = ? WHERE event_id = ?', [iso(next), row.event_id]);
  }
}

function settle(sql: Sql, rows: readonly OutboxRow[], results: readonly EventReceipt[], deps: SyncDeps) {
  const sent = new Map(rows.map((row) => [row.event_id, row]));
  const unanswered = new Map(sent);
  let accepted = 0;
  let needsAttention = 0;
  sql.tx(() => {
    for (const r of results) {
      const row = sent.get(r.event_id);
      if (!row) continue; // Never act on a receipt for an event this pass did not send.
      unanswered.delete(r.event_id);
      if (r.error?.retryable) {
        schedule(sql, [row], deps);
        continue;
      }
      sql.run(
        `INSERT INTO sync_receipts (event_id, sample_id, status, code, detail, server_time) VALUES (?,?,?,?,?,?)
         ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, code = excluded.code,
           detail = excluded.detail, server_time = excluded.server_time`,
        [r.event_id, row.sample_id, r.status, r.error?.code ?? null, r.error?.detail ?? null, r.server_time],
      );
      sql.run('DELETE FROM outbox WHERE event_id = ?', [r.event_id]);
      if (r.status === 'accepted' || r.status === 'duplicate') accepted++;
      else needsAttention++;
    }
    // A 200 that omits an event is not an acknowledgement of it.
    schedule(sql, [...unanswered.values()], deps);
  });
  return { accepted, needsAttention };
}

function rejectLocally(sql: Sql, row: OutboxRow, code: string, deps: SyncDeps): void {
  sql.tx(() => {
    sql.run(
      'INSERT OR REPLACE INTO sync_receipts (event_id, sample_id, status, code, detail, server_time) VALUES (?,?,?,?,?,?)',
      [row.event_id, row.sample_id, 'rejected', code, 'The server refused this record as invalid.', iso(deps.now())],
    );
    sql.run('DELETE FROM outbox WHERE event_id = ?', [row.event_id]);
  });
}

async function pushRows(rows: OutboxRow[], deps: SyncDeps, tally: { accepted: number; needsAttention: number }): Promise<StepResult> {
  const outcome = await deps.transport.push(deps.deviceId, rows.map(toEvent));
  if (outcome.kind === 'ok') {
    const counts = settle(deps.sql, rows, outcome.value.results, deps);
    tally.accepted += counts.accepted;
    tally.needsAttention += counts.needsAttention;
    return 'done';
  }
  if (outcome.kind === 'auth_required') return 'auth_paused';
  if (outcome.kind === 'failed' && outcome.status === 403) return 'forbidden';
  if (outcome.kind === 'failed' && outcome.status === 422) {
    // The envelope is rejected whole before processing. Isolate the bad
    // record instead of letting it block every record queued behind it.
    if (rows.length > 1) {
      for (const row of rows) {
        const single = await pushRows([row], deps, tally);
        if (single !== 'done') return single;
      }
      return 'done';
    }
    rejectLocally(deps.sql, rows[0], outcome.code ?? 'VALIDATION_FAILED', deps);
    tally.needsAttention++;
    return 'done';
  }
  deps.sql.tx(() => schedule(deps.sql, rows, deps));
  return outcome.kind === 'offline' ? 'offline' : 'server_error';
}

async function push(deps: SyncDeps, session: SyncSession, manual: boolean, tally: { accepted: number; needsAttention: number }): Promise<StepResult> {
  const rows = due(deps.sql, deps.owner, iso(deps.now()), manual);
  if (rows.length === 0) return 'nothing_due';
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    if (!manual) {
      if (session.autoAttempts >= MAX_AUTO_ATTEMPTS_PER_SESSION) return 'session_limit';
      session.autoAttempts++;
    }
    const result = await pushRows(rows.slice(i, i + PUSH_BATCH), deps, tally);
    if (result !== 'done') return result;
  }
  return 'done';
}

const cursorKey = (owner: string) => `sync_cursor:${owner}`;

function stepFor(outcome: Exclude<ApiOutcome<unknown>, { kind: 'ok' }>): StepResult {
  if (outcome.kind === 'auth_required') return 'auth_paused';
  if (outcome.kind === 'offline') return 'offline';
  return outcome.status === 403 ? 'forbidden' : 'server_error';
}

async function rebootstrap(deps: SyncDeps): Promise<StepResult> {
  const sources: Array<{ id: string; qrCode: string; label: string; locality: string; latitude: number | null; longitude: number | null }> = [];
  let servedAt: string | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page++) {
    const r = await deps.transport.bootstrap(cursor);
    if (r.kind !== 'ok') return stepFor(r);
    servedAt ??= r.value.server_time;
    for (const s of r.value.sources) {
      sources.push({ id: s.id, qrCode: s.qr_code, label: s.label, locality: s.locality, latitude: s.latitude, longitude: s.longitude });
    }
    if (r.value.snapshot_cursor) {
      const snapshot = r.value.snapshot_cursor;
      // Catalogue and the cursor it pairs with commit together.
      deps.sql.tx(() => {
        writeCatalogue(deps.sql, deps.owner, sources, servedAt!);
        setMeta(deps.sql, cursorKey(deps.owner), snapshot);
      });
      return 'done';
    }
    cursor = r.value.next_cursor;
    if (!cursor) return 'server_error'; // Neither a next page nor a snapshot: a server bug.
  }
  return 'server_error';
}

async function pull(deps: SyncDeps): Promise<{ step: StepResult; pulled: number }> {
  let pulled = 0;
  let reset = false;
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    let cursor = getMeta(deps.sql, cursorKey(deps.owner));
    if (!cursor) {
      const boot = await rebootstrap(deps);
      if (boot !== 'done') return { step: boot, pulled };
      cursor = getMeta(deps.sql, cursorKey(deps.owner))!;
    }
    const r = await deps.transport.pull(cursor);
    if (r.kind !== 'ok') {
      const refused = r.kind === 'failed' && (r.status === 410 || (r.status === 422 && r.code === 'VALIDATION_FAILED'));
      if (refused && !reset) {
        // Expired or foreign cursor: forget it and re-bootstrap once. The
        // outbox is untouched — pending records are never part of a reset.
        reset = true;
        deps.sql.run('DELETE FROM meta WHERE key = ?', [cursorKey(deps.owner)]);
        continue;
      }
      return { step: stepFor(r), pulled };
    }
    const body = r.value;
    deps.sql.tx(() => {
      for (const change of body.changes) {
        if (change.entity_type !== 'sample' || !change.sample) continue;
        deps.sql.run(
          `INSERT INTO server_samples (owner, id, event_id, seq, status, received_at_server) VALUES (?,?,?,?,?,?)
           ON CONFLICT(owner, id) DO UPDATE SET seq = excluded.seq, status = excluded.status,
             received_at_server = excluded.received_at_server`,
          [deps.owner, change.sample.id, change.sample.event_id, change.seq, change.sample.status, change.sample.received_at_server],
        );
      }
      setMeta(deps.sql, cursorKey(deps.owner), body.next_cursor);
    });
    pulled += body.changes.length;
    if (!body.has_more) return { step: 'done', pulled };
  }
  return { step: 'done', pulled };
}

/**
 * One foreground sync pass. `manual` is an explicit "Sync Now" tap: it sends
 * every pending record now, ignoring backoff and the automatic-attempt cap.
 */
export async function syncOnce(deps: SyncDeps, session: SyncSession, opts: { manual?: boolean } = {}): Promise<SyncResult> {
  const tally = { accepted: 0, needsAttention: 0 };
  const pushed = await push(deps, session, opts.manual === true, tally);
  const blocked = pushed === 'offline' || pushed === 'auth_paused' || pushed === 'forbidden';
  const pulled = blocked ? { step: 'skipped' as const, pulled: 0 } : await pull(deps);
  return { push: pushed, pull: pulled.step, ...tally, pulled: pulled.pulled };
}

// --- queue view --------------------------------------------------------------

export type QueueState =
  | 'saved_on_phone'
  | 'waiting_to_retry'
  | 'accepted'
  | 'accepted_confirmed'
  | 'needs_attention'
  | 'inconsistent';

export interface QueueItem {
  sampleId: string;
  savedAt: string;
  state: QueueState;
  attempt: number;
  nextAttemptAt: string | null;
  code: string | null;
  serverTime: string | null;
}

export function queueItems(sql: Sql, owner: string): QueueItem[] {
  const rows = sql.all<{
    id: string; saved_at: string; in_outbox: number | null; attempt: number | null; next_attempt_at: string | null;
    status: string | null; code: string | null; server_time: string | null; confirmed: number | null;
  }>(
    `SELECT s.id, s.saved_at, o.sample_id IS NOT NULL AS in_outbox, o.attempt, o.next_attempt_at,
            r.status, r.code, r.server_time, ss.id IS NOT NULL AS confirmed
       FROM local_samples s
       LEFT JOIN outbox o ON o.sample_id = s.id
       LEFT JOIN sync_receipts r ON r.event_id = s.event_id
       LEFT JOIN server_samples ss ON ss.owner = s.owner AND ss.id = s.id
      WHERE s.owner = ?
      ORDER BY s.saved_at DESC, s.id`,
    [owner],
  );
  return rows.map((row) => {
    let state: QueueState;
    if (row.in_outbox) state = row.attempt ? 'waiting_to_retry' : 'saved_on_phone';
    else if (row.status === 'accepted' || row.status === 'duplicate') state = row.confirmed ? 'accepted_confirmed' : 'accepted';
    else if (row.status === 'rejected' || row.status === 'conflict') state = 'needs_attention';
    // Save writes the outbox row and receipts replace it atomically, so this
    // cannot happen; if it does, show it rather than hide it.
    else state = 'inconsistent';
    return {
      sampleId: row.id, savedAt: row.saved_at, state, attempt: row.attempt ?? 0,
      nextAttemptAt: row.next_attempt_at, code: row.code, serverTime: row.server_time,
    };
  });
}

export function pendingCount(sql: Sql, owner: string): number {
  return sql.all<{ n: number }>(
    'SELECT count(*) AS n FROM outbox o JOIN local_samples s ON s.id = o.sample_id WHERE s.owner = ?',
    [owner],
  )[0].n;
}

// --- wording -------------------------------------------------------------------
// Each state says exactly how far the record got. "Saved" is durable on this
// phone; it is not "sent", and "accepted by server" is not "verified" and says
// nothing about the water. The photo is never uploaded in M1 (T16).

export const QUEUE_TEXT: Record<QueueState, { label: string; detail: string; tone: 'unknown' | 'watch' | 'alert' }> = {
  saved_on_phone: { label: 'Saved on this phone', detail: 'Not sent yet.', tone: 'watch' },
  waiting_to_retry: { label: 'Saved on this phone', detail: 'Sending failed; it will be retried.', tone: 'watch' },
  accepted: { label: 'Accepted by server', detail: 'The server stored this record.', tone: 'unknown' },
  accepted_confirmed: {
    label: 'Accepted by server',
    detail: 'The server stored this record and it appears in the server’s record list.',
    tone: 'unknown',
  },
  needs_attention: { label: 'Not accepted', detail: 'The server did not accept this record. It is kept on this phone.', tone: 'alert' },
  inconsistent: { label: 'Check this record', detail: 'Its sync state is unclear. It is kept on this phone.', tone: 'alert' },
};

export const PHOTO_NOTE = 'Photos stay on this phone. Photo upload is not part of this version.';
export const FOREGROUND_NOTE = 'Records are sent only while this app is open.';

export const STEP_TEXT: Record<StepResult | 'skipped', string> = {
  done: 'Sync finished.',
  nothing_due: 'Nothing waiting to send.',
  offline: 'No connection. Saved records stay on this phone and will be sent later.',
  auth_paused: 'Sign in again to send saved records. Nothing was lost.',
  forbidden: 'This account cannot send records. Nothing was lost.',
  server_error: 'The server could not be reached properly. Saved records will be retried.',
  session_limit: 'Automatic retries paused for now. Tap Sync now to try again.',
  skipped: '',
};
