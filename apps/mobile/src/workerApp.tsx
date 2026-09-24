/**
 * JalSakshi — WORKER app: the M1 field flow, end to end.
 *
 *   1. Source   — T07: server catalogue, cached on the phone per account
 *   2. Protocol — T08: SYN-COLOR-001 read window (SYNTHETIC, ADR-M1-001)
 *   3. Capture  — T09: photo + manual region, or manual without a photo
 *   4. Review   — T11/T26: the bundled research model may suggest a bin, but
 *                 only after timing, capture quality and features pass
 *   5. Save     — T12: durable local receipt before anything is claimed
 *   6. Queue    — T15: foreground sync, Sync now, per-record status
 *
 * Plus Model check (T26): runs the bundled model offline on golden synthetic
 * captures and compares it with the desktop build.
 *
 * Wording rules (tests/status-label.test.ts, tests/sync-client.test.ts): no
 * potability claim, no confidence percentage, no closed-app sync claim.
 *
 * Known M1 limits, recorded rather than hidden:
 *   - The monotonic clock is `performance.now()` (process-relative) with a
 *     null boot id: a restart mid-test yields `indeterminate`, the safe
 *     direction. Binding SystemClock.elapsedRealtime() is role B's (T08).
 *   - SYN-COLOR-001 requires a reference card and no card locator exists, so
 *     capture quality is recorded as QUALITY_NOT_ASSESSED. The quality gate
 *     therefore never passes, the model is never asked, and every reading is
 *     manual - by design, until a locator exists (project-owner decision).
 */

import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { gate, type ReviewAnalysis, type ReviewObservation } from './analysis/baseline';
import { analyseWithModel, type ModelInput } from './analysis/model';
import { loadBundledModel } from './analysis/modelLoader';
import { API_BASE, fetchCatalogue, httpTransport } from './api';
import { CaptureScreen } from './capture';
import { deviceId, deviceSql } from './deviceDb';
import { checkOfflineAccess, LOCK_TEXT, revokeOfflineAccess, type OfflineAccess } from './offlineAccess';
import { BINS, INSTRUCTIONS, PROTOCOL, REQUIRE_REFERENCE_CARD, SYNTHETIC_LOT } from './m1Protocol';
import { ModelCheckScreen } from './modelCheck';
import { ProtocolScreen } from './protocol';
import { QueueScreen } from './queue';
import { ReviewScreen } from './review';
import { buildSample } from './sample';
import type { Session } from './session';
import { freshnessLabel, freshnessOf, type CachedSource } from './sourceCatalog';
import { SourcesScreen } from './sources';
import {
  applyCatalogueFetch, loadCatalogue, openLocalStorage,
  type CatalogueView, type LocalReceipt, type LocalSaveInput,
} from './storage';
import { pendingCount, queueItems, STEP_TEXT, syncOnce, type QueueItem, type SyncResult, type SyncSession } from './sync';
import { colors, radius, spacing, type } from './theme';
import type { Attempt, TimingVerdict } from './timer';
import { Card, CardTitle, Row, StepRail } from './ui';

const STEPS = ['Source', 'Protocol', 'Capture', 'Review', 'Save'] as const;
const CLIENT_BUILD = 'jalsakshi-mobile/m1-synthetic';

const PROBLEM_TEXT: Record<NonNullable<CatalogueView['problem']>, string> = {
  offline: 'Offline — showing the copy saved on this phone.',
  auth_required: 'Your sign-in has expired. Sign in again to refresh.',
  server_error: 'The server could not send the source list — showing the saved copy.',
};

type Step =
  | { name: 'source' }
  | { name: 'protocol'; source: CachedSource }
  | { name: 'capture'; source: CachedSource; attempt: Attempt; timing: TimingVerdict }
  | { name: 'review'; source: CachedSource; timing: TimingVerdict; photoUri: string | null; capturedAt: string }
  | { name: 'saving'; input: LocalSaveInput; error: string | null }
  | { name: 'saved'; receipt: LocalReceipt }
  | { name: 'queue' }
  | { name: 'model_check' };

/** Review with the on-device model. The gate answers synchronously; the model
 *  is only loaded and asked when timing, quality and features all pass. */
function ModelReview({ input, onComplete, onRetake }: {
  input: ModelInput; onComplete(o: ReviewObservation): void; onRetake(): void;
}): React.JSX.Element {
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(() => gate({ ...input, profile: null }));
  useEffect(() => {
    if (analysis) return;
    let live = true;
    void loadBundledModel()
      .then((state) => analyseWithModel(input, state, BINS))
      .then((result) => { if (live) setAnalysis(result); });
    return () => { live = false; };
    // Once per review: the input does not change while this step is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!analysis) return <Text style={s.body}>Analysing on this phone…</Text>;
  return <ReviewScreen analysis={analysis} bins={BINS} onComplete={onComplete} onRetake={onRetake} />;
}

export interface WorkerAppProps {
  session: Session;
  /** Called when the server rejects the token; the host returns to sign-in. */
  onAuthExpired(): void;
  now?: () => number;
}

export function WorkerApp({ session, onAuthExpired, now = Date.now }: WorkerAppProps): React.JSX.Element {
  const owner = session.auth.subject;
  const [catalogue, setCatalogue] = useState<CatalogueView>(() => ({
    ...loadCatalogue(deviceSql(), owner), origin: 'cache', problem: null,
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'source' });
  const [queue, setQueue] = useState<{ items: QueueItem[]; pending: number }>(() => ({
    items: queueItems(deviceSql(), owner), pending: pendingCount(deviceSql(), owner),
  }));
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [locked, setLocked] = useState<Extract<OfflineAccess, { kind: 'locked' }>['reason'] | null>(null);
  const storage = useRef<ReturnType<typeof openLocalStorage> | null>(null);
  const syncSession = useRef<SyncSession>({ autoAttempts: 0 });
  const running = useRef(false);

  storage.current ??= openLocalStorage(deviceSql());

  /** T45: an offline session re-checks its lease; online sessions have a token instead. */
  const leaseHolds = useCallback((): boolean => {
    if (session.offlineUntilMs === null) return true;
    const access = checkOfflineAccess(deviceSql(), owner, Date.now());
    if (access.kind === 'granted') return true;
    setLocked(access.reason);
    return false;
  }, [session.offlineUntilMs, owner]);

  const reloadQueue = useCallback(() => {
    setQueue({ items: queueItems(deviceSql(), owner), pending: pendingCount(deviceSql(), owner) });
  }, [owner]);

  const sync = useCallback(async (manual: boolean) => {
    if (running.current) return; // One pass at a time; a second tap is not a second push.
    running.current = true;
    setSyncing(true);
    let result: SyncResult | null = null;
    try {
      result = await syncOnce(
        { sql: deviceSql(), transport: httpTransport(API_BASE, session.auth.token), owner, deviceId: deviceId(), now: Date.now, random: Math.random },
        syncSession.current,
        { manual },
      );
      setSyncStatus(STEP_TEXT[result.push === 'done' || result.push === 'nothing_due' ? result.pull : result.push]);
      setCatalogue({ ...loadCatalogue(deviceSql(), owner), origin: 'cache', problem: null });
    } catch {
      setSyncStatus('Sync stopped unexpectedly. Saved records are still on this phone.');
    } finally {
      running.current = false;
      setSyncing(false);
      reloadQueue();
    }
    if (result?.push === 'forbidden' || result?.pull === 'forbidden') {
      // Membership revoked or scope removed: the server's refusal wins over any
      // lease. Offline access ends; every saved record stays on the phone.
      revokeOfflineAccess(deviceSql(), owner);
      onAuthExpired();
    } else if (result?.push === 'auth_paused' || result?.pull === 'auth_paused') {
      onAuthExpired();
    }
  }, [owner, session.auth.token, reloadQueue, onAuthExpired]);

  const refresh = async () => {
    setRefreshing(true);
    const outcome = await fetchCatalogue(API_BASE, session.auth.token);
    setCatalogue(applyCatalogueFetch(deviceSql(), owner, outcome));
    setRefreshing(false);
    if (outcome.kind === 'auth_required') onAuthExpired();
  };

  useEffect(() => {
    if (!leaseHolds()) return;
    void refresh();
    void sync(false);
    // Each return to the foreground is a new session: reopen retries.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && leaseHolds()) {
        syncSession.current = { autoAttempts: 0 };
        void sync(false);
      }
    });
    return () => sub.remove();
    // Once per signed-in account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const save = async (input: LocalSaveInput) => {
    if (!leaseHolds()) return;
    setStep({ name: 'saving', input, error: null });
    try {
      const receipt = await (await storage.current!).save(input);
      setStep({ name: 'saved', receipt });
      reloadQueue();
      void sync(false);
    } catch (error) {
      // Never report success on failure. Retrying reuses the same ids, so
      // T12's idempotent save cannot create a second record.
      setStep({ name: 'saving', input, error: error instanceof Error ? error.message : 'Unknown storage error' });
    }
  };

  const onReviewed = (review: Extract<Step, { name: 'review' }>, observation: ReviewObservation) => {
    const sampleId = randomUUID();
    const sample = buildSample(
      { sampleId, sourceId: review.source.id, protocol: PROTOCOL, kitLotId: SYNTHETIC_LOT.id, capturedAtDevice: review.capturedAt, clientBuild: CLIENT_BUILD },
      review.timing,
      observation,
    );
    void save({
      owner,
      eventId: randomUUID(),
      assetId: review.photoUri ? randomUUID() : null,
      sourceUri: review.photoUri,
      mediaType: review.photoUri ? 'image/jpeg' : null,
      sample,
    });
  };

  const queueButton = (
    <Pressable style={s.btn} onPress={() => { reloadQueue(); setStep({ name: 'queue' }); }} accessibilityRole="button" testID="open-queue">
      <Text style={s.btnText}>
        Saved records{queue.pending ? ` — ${queue.pending} waiting to send` : ''}
      </Text>
    </Pressable>
  );

  if (locked) {
    // Locked: no new tests, nothing deleted. The queue is shown so the worker
    // can see their records are still here.
    return (
      <View style={[s.screen, s.pad]}>
        <Card>
          <CardTitle>Offline access stopped</CardTitle>
          <Text style={s.body} testID="offline-locked">{LOCK_TEXT[locked]}</Text>
          <Text style={s.body} testID="locked-pending">
            {queue.pending} saved record{queue.pending === 1 ? '' : 's'} kept on this phone. They will be sent after sign-in.
          </Text>
        </Card>
        <Pressable style={s.btn} onPress={onAuthExpired} accessibilityRole="button" testID="locked-sign-in">
          <Text style={s.btnText}>Go to sign in</Text>
        </Pressable>
      </View>
    );
  }

  switch (step.name) {
    case 'source': {
      const age = freshnessLabel(freshnessOf(catalogue.servedAt, now()));
      return (
        <View style={s.screen}>
          <View style={s.pad}>
            <StepRail steps={STEPS} current={0} />
            <Text style={s.meta} testID="catalogue-status">
              {refreshing ? 'Updating source list…' : catalogue.problem ? PROBLEM_TEXT[catalogue.problem] : 'Source list from server.'}
              {catalogue.servedAt ? ` ${age.replace('Last known record', 'Saved list')}.` : ''}
            </Text>
            {queueButton}
            <Pressable style={s.btnGhost} onPress={() => setStep({ name: 'model_check' })} accessibilityRole="button" testID="open-model-check">
              <Text style={s.btnGhostText}>Model check (research)</Text>
            </Pressable>
          </View>
          <SourcesScreen cache={catalogue.items} onSelectSource={(source) => setStep({ name: 'protocol', source })} now={now} />
        </View>
      );
    }
    case 'protocol':
      return (
        <View style={s.screen}>
          <View style={s.pad}><StepRail steps={STEPS} current={1} /><Text style={s.meta}>Source: {step.source.label}</Text></View>
          <ProtocolScreen
            protocol={PROTOCOL}
            lot={SYNTHETIC_LOT}
            instructions={INSTRUCTIONS}
            readClock={() => ({ wallMs: Date.now(), monotonicMs: performance.now(), bootId: null })}
            newAttemptId={randomUUID}
            onProceedToCapture={(attempt, timing) => setStep({ name: 'capture', source: step.source, attempt, timing })}
          />
        </View>
      );
    case 'capture': {
      const toReview = (photoUri: string | null) =>
        setStep({ name: 'review', source: step.source, timing: step.timing, photoUri, capturedAt: new Date().toISOString() });
      return (
        <View style={s.screen}>
          <View style={s.pad}><StepRail steps={STEPS} current={2} /></View>
          <CaptureScreen
            request={{
              sourceId: step.source.id, protocolId: PROTOCOL.id, protocolVersion: PROTOCOL.version,
              attemptId: step.attempt.attemptId, requireReferenceCard: REQUIRE_REFERENCE_CARD,
            }}
            newJobId={randomUUID}
            onManualEntry={() => toReview(null)}
            onAnalysed={(_features, _corners, _orientation, photoUri) => toReview(photoUri)}
          />
        </View>
      );
    }
    case 'review':
      return (
        <View style={s.screen}>
          <View style={s.pad}>
            <StepRail steps={STEPS} current={3} />
            <Text style={s.meta}>{step.photoUri ? 'Photo kept on this phone.' : 'No photo — manual reading only.'}</Text>
          </View>
          <ModelReview
            input={{
              features: null,
              quality: { decision: 'review', reasons: ['QUALITY_NOT_ASSESSED'] },
              timingValid: step.timing.timingValid,
            }}
            onComplete={(observation) => onReviewed(step, observation)}
            onRetake={() => setStep({ name: 'protocol', source: step.source })}
          />
        </View>
      );
    case 'model_check':
      return <ModelCheckScreen onBack={() => setStep({ name: 'source' })} />;
    case 'saving':
      return (
        <View style={[s.screen, s.pad]}>
          <StepRail steps={STEPS} current={4} />
          {step.error ? (
            <Card>
              <CardTitle>Not saved</CardTitle>
              <Text style={s.body} testID="save-error">The reading was NOT saved: {step.error}</Text>
              <Pressable style={s.btn} onPress={() => void save(step.input)} accessibilityRole="button" testID="save-retry">
                <Text style={s.btnText}>Try saving again</Text>
              </Pressable>
            </Card>
          ) : (
            <Text style={s.body}>Saving on this phone…</Text>
          )}
        </View>
      );
    case 'saved':
      return (
        <ScrollView contentContainerStyle={s.pad} style={s.screen}>
          <StepRail steps={STEPS} current={4} />
          <Card>
            <CardTitle>Saved on this phone</CardTitle>
            <Text style={s.body} testID="saved-receipt">
              This reading is stored on this phone and survives closing the app. It has not been sent yet unless the queue says so.
            </Text>
            <Row label="Record" value={step.receipt.sampleId} />
            <Row label="Saved at" value={new Date(step.receipt.savedAt).toLocaleString()} />
            <Row label="Photo" value={step.receipt.assetId ? `Kept on this phone (${step.receipt.assetBytes} bytes)` : 'None — manual reading'} />
            <Row label="Record fingerprint" value={step.receipt.payloadHash.slice(0, 16)} />
          </Card>
          {queueButton}
          <Pressable style={s.btnGhost} onPress={() => setStep({ name: 'source' })} accessibilityRole="button" testID="new-test">
            <Text style={s.btnGhostText}>Start another test</Text>
          </Pressable>
        </ScrollView>
      );
    case 'queue':
      return (
        <QueueScreen
          items={queue.items}
          pending={queue.pending}
          status={syncStatus}
          busy={syncing}
          onSyncNow={() => void sync(true)}
          onBack={() => setStep({ name: 'source' })}
        />
      );
  }
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg, gap: spacing.md },
  meta: { ...type.small },
  body: { ...type.body, color: colors.text },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnText: { ...type.body, color: '#fff', fontWeight: '700' },
  btnGhost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  btnGhostText: { ...type.body, color: colors.text },
});
