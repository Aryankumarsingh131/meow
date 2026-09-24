/**
 * T09: S04 Capture — guided camera, reference frame, manual ROI.
 *
 * Every lifecycle transition goes through `./captureJob`, which is where the
 * J02 guarantee lives ("retaking creates a new capture job; cancelled/late
 * model output cannot overwrite it"). This file holds JSX, the camera, and
 * the ROI gesture handling — no job-ordering logic of its own, because a
 * second implementation of that rule is a second chance to get it wrong.
 *
 * Layout follows ui-ux-specification.md S04: "Camera preview, reference frame
 * guide, shutter, manual fallback", with edge states "Missing reference;
 * glare/blur reason; camera denied; decoding error; cancel; busy capture
 * cannot queue unlimited jobs".
 *
 * ## Honest limits
 *
 * - **Analysis is not available on device.** `computeFeaturesNative` in
 *   modules/capture-native (T04, role B) rejects by design — the Kotlin module
 *   has never been compiled. This screen surfaces that as `native_unavailable`
 *   and opens the manual route, rather than fabricating a feature vector.
 * - **No reference-card detection exists.** Nothing in the codebase locates
 *   the card; the native bridge takes corners as input. Automatic detection
 *   and quality scoring (glare/blur) are T10. Until then the worker marks the
 *   region by hand, which is the AC-003 "manual corner adjustment remains
 *   available" path.
 * - This screen has never been rendered on a physical phone. It has been run
 *   on an Android emulator, whose camera is a synthetic scene.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { computeFeaturesNative, type Point } from '../../../modules/capture-native/index';
import {
  FAILURE_PROMPT,
  cancelJob,
  defaultManualRoi,
  initialCaptureState,
  settleJob,
  startJob,
  toUprightPoint,
  uprightSize,
  validateRoi,
  type CaptureFailureReason,
  type CaptureRequest,
  type CaptureState,
  type RoiCorners,
} from './captureJob';

export interface CaptureScreenProps {
  request: CaptureRequest;
  /** Generates a fresh job id (UUID). Never derived from a previous one. */
  newJobId(): string;
  /** Worker chose to type the reading instead. Owned by T11. */
  onManualEntry(reason: CaptureFailureReason | 'worker_choice'): void;
  /** A capture was analysed and accepted by the worker. */
  /** `photoUri` is the capture file; T12 copies it into private storage on save. */
  onAnalysed(features: unknown, corners: RoiCorners, orientation: number, photoUri: string): void;
  now?: () => number;
}

interface Shot {
  uri: string;
  /** Stored (pre-EXIF-correction) dimensions. */
  width: number;
  height: number;
  orientation: number;
}

export function CaptureScreen({
  request,
  newJobId,
  onManualEntry,
  onAnalysed,
  now = Date.now,
}: CaptureScreenProps): React.JSX.Element {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<CaptureState>(initialCaptureState);
  const [shot, setShot] = useState<Shot | null>(null);
  const [roi, setRoi] = useState<RoiCorners | null>(null);
  const [selectedCorner, setSelectedCorner] = useState(0);
  const [preview, setPreview] = useState({ width: 1, height: 1 });
  const [busy, setBusy] = useState(false);

  const failure =
    state.last?.status === 'failed' ? state.last.reason : null;

  /**
   * Take a photo and analyse it.
   *
   * The job is started BEFORE the await, so a retake during analysis
   * supersedes this job immediately rather than at result time.
   */
  const capture = useCallback(async () => {
    if (!camera.current) return;
    const jobId = newJobId();
    const started = startJob(state, jobId, request, now());
    setState(started.state);
    setBusy(true);

    try {
      const photo = await camera.current.takePictureAsync({ exif: true, quality: 1 });
      if (!photo) throw new Error('no photo');
      const orientation = Number(photo.exif?.Orientation ?? 1);
      setShot({ uri: photo.uri, width: photo.width, height: photo.height, orientation });

      // No card detection exists yet (T10), so there are no automatic corners.
      // Report that honestly and let the worker mark the region by hand.
      if (request.requireReferenceCard) {
        setState((s) => settleJob(s, jobId, {
          kind: 'failed',
          reason: 'reference_card_missing',
        }).state);
        const size = uprightSize(orientation, photo.width, photo.height);
        setRoi(defaultManualRoi(size.width, size.height));
        return;
      }

      // Native analysis. The bridge now takes a file URI plus the ROI quad in
      // the upright frame (T04 interface change, 2026-09-22 — the old
      // byte-array signature was never callable).
      //
      // Without corners there is nothing to analyse, so this reports
      // roi_invalid rather than calling native with an empty quad and letting
      // it fail deeper down.
      if (!roi) {
        setState((s) => settleJob(s, jobId, { kind: 'failed', reason: 'roi_invalid' }).state);
        return;
      }
      const features = await computeFeaturesNative(photo.uri, roi, 16);
      setState((s) => settleJob(s, jobId, {
        kind: 'analysed',
        features,
        corners: roi,
        orientation,
      }).state);
    } catch {
      setState((s) => settleJob(s, jobId, {
        kind: 'failed',
        reason: 'native_unavailable',
      }).state);
    } finally {
      setBusy(false);
    }
  }, [state, request, newJobId, now, roi]);

  const cancel = useCallback(() => {
    if (state.active) setState(cancelJob(state, state.active.jobId));
    setBusy(false);
  }, [state]);

  /** Move the selected ROI corner to where the worker tapped. */
  const onPreviewPress = useCallback(
    (locationX: number, locationY: number) => {
      if (!shot || !roi) return;
      // Preview pixels -> stored pixels -> upright frame. Skipping the last
      // step would analyse the wrong region on a rotated photo (AC-003).
      const storedX = (locationX / preview.width) * shot.width;
      const storedY = (locationY / preview.height) * shot.height;
      const upright = toUprightPoint(
        { x: storedX, y: storedY },
        shot.orientation,
        shot.width,
        shot.height,
      );
      const next = roi.map((p, i) => (i === selectedCorner ? upright : p)) as unknown as RoiCorners;
      setRoi(next);
    },
    [shot, roi, preview, selectedCorner],
  );

  const confirmRoi = useCallback(() => {
    if (!shot || !roi) return;
    const size = uprightSize(shot.orientation, shot.width, shot.height);
    const check = validateRoi(roi, size.width, size.height);
    if (!check.valid) {
      // Refused, not clamped: the worker's corners are theirs.
      const jobId = newJobId();
      const started = startJob(state, jobId, request, now());
      setState(settleJob(started.state, jobId, { kind: 'failed', reason: 'roi_invalid' }).state);
      return;
    }
    onAnalysed(null, check.corners, shot.orientation, shot.uri);
  }, [shot, roi, state, request, newJobId, now, onAnalysed]);

  const onPreviewLayout = (e: LayoutChangeEvent) =>
    setPreview({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  // --- permission states --------------------------------------------------

  if (!permission) {
    return <Centered text="Checking camera permission…" />;
  }

  if (!permission.granted) {
    // Acceptance criterion 1: a denial is never a dead end. The worker can
    // grant and retry, or type the reading instead.
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>{FAILURE_PROMPT.permission_denied}</Text>
        {permission.canAskAgain ? (
          <Pressable style={styles.primary} onPress={requestPermission} accessibilityRole="button">
            <Text style={styles.primaryText}>Allow camera</Text>
          </Pressable>
        ) : (
          <Text style={styles.body}>
            Camera access was turned off for this app. Enable it in Settings, then come back.
          </Text>
        )}
        <Pressable
          style={styles.secondary}
          onPress={() => onManualEntry('permission_denied')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Enter kit reading manually</Text>
        </Pressable>
      </View>
    );
  }

  // --- manual ROI over the captured still ---------------------------------

  if (shot && roi) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Mark the strip</Text>
        {failure && <Text style={styles.warn}>{FAILURE_PROMPT[failure]}</Text>}

        <Pressable
          style={styles.previewWrap}
          onLayout={onPreviewLayout}
          onPress={(e) => onPreviewPress(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          accessibilityRole="button"
          accessibilityLabel="Tap to move the selected corner"
        >
          <Image source={{ uri: shot.uri }} style={styles.preview} resizeMode="contain" />
        </Pressable>

        <View style={styles.cornerRow}>
          {(['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const).map((label, i) => (
            <Pressable
              key={label}
              style={[styles.cornerChip, selectedCorner === i && styles.cornerChipActive]}
              onPress={() => setSelectedCorner(i)}
              accessibilityRole="button"
            >
              <Text style={selectedCorner === i ? styles.cornerTextActive : styles.cornerText}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.primary} onPress={confirmRoi} accessibilityRole="button">
          <Text style={styles.primaryText}>Use this region</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => {
            setShot(null);
            setRoi(null);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Retake photo</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => onManualEntry('worker_choice')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Enter kit reading manually</Text>
        </Pressable>
      </View>
    );
  }

  // --- live preview -------------------------------------------------------

  return (
    <View style={styles.container}>
      <View style={styles.cameraWrap}>
        {/* `flex: 1`, not StyleSheet.absoluteFill. An absolutely-positioned
            CameraView gets no measured size from the layout pass, so the
            native preview surface renders black even though the camera is
            open and delivering frames. */}
        <CameraView ref={camera} style={styles.camera} facing="back" />
        {/* Reference frame guide: where to place strip and card. Purely a
            visual aid — it does not detect or validate anything. */}
        <View pointerEvents="none" style={styles.guide}>
          <View style={styles.guideBox} />
          <Text style={styles.guideText}>Place the strip and the reference card inside the frame</Text>
        </View>
      </View>

      {failure && <Text style={styles.warn}>{FAILURE_PROMPT[failure]}</Text>}

      <Pressable
        style={styles.primary}
        onPress={capture}
        accessibilityRole="button"
        accessibilityLabel="Take photo"
      >
        <Text style={styles.primaryText}>{busy ? 'Working…' : 'Take photo'}</Text>
      </Pressable>

      {busy && (
        <Pressable style={styles.secondary} onPress={cancel} accessibilityRole="button">
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      )}

      <Pressable
        style={styles.secondary}
        onPress={() => onManualEntry('worker_choice')}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>Enter kit reading manually</Text>
      </Pressable>
    </View>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={[styles.container, styles.centered]}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 14, color: '#333' },
  warn: { fontSize: 14, color: '#8a5300', fontWeight: '600' },
  cameraWrap: { flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' },
  camera: { flex: 1 },
  guide: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  guideBox: {
    width: '78%',
    aspectRatio: 1.6,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
  },
  guideText: { color: '#fff', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  previewWrap: { flex: 1, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' },
  preview: { width: '100%', height: '100%' },
  cornerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cornerChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#eee' },
  cornerChipActive: { backgroundColor: '#14507d' },
  cornerText: { fontSize: 13, color: '#333' },
  cornerTextActive: { fontSize: 13, color: '#fff', fontWeight: '700' },
  primary: { backgroundColor: '#14507d', padding: 14, borderRadius: 8, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { borderWidth: 1, borderColor: '#14507d', padding: 12, borderRadius: 8, alignItems: 'center' },
  secondaryText: { color: '#14507d', fontSize: 15 },
});
