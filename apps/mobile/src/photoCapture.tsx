/**
 * Take one photo for upload (Pluccy's proof photo, a resident's complaint
 * photo): live camera with a framing guide, torch, zoom and tap-to-refocus,
 * then a preview to retake or use. JPEG at reduced quality so it stays well
 * under the server's 10 MiB cap; the server still checks the file signature
 * and size itself.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';
import type { Photo } from './v2';

const ZOOMS = [0, 0.15, 0.3] as const;   // expo-camera zoom is 0..1 of the device range
const ZOOM_LABEL = ['1×', '2×', '3×'];

export function PhotoCapture({ prompt, onPhoto, onSkip, skipLabel }: {
  prompt: string;
  onPhoto(photo: Photo): void;
  onSkip(): void;
  skipLabel: string;
}): React.JSX.Element {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [focus, setFocus] = useState<'on' | 'off'>('on');
  const [shot, setShot] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async () => {
    if (!camera.current || busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await camera.current.takePictureAsync({ base64: true, quality: 0.6, exif: false, shutterSound: false });
      if (!pic?.base64) throw new Error('no image data');
      setShot({ uri: pic.uri, base64: pic.base64 });
      setTorch(false);
    } catch {
      setError('The photo could not be taken. Hold still and try again.');
    } finally {
      setBusy(false);
    }
  };
  // Android refocuses when autofocus is switched; a tap on the preview does that.
  const refocus = () => { setFocus('off'); setTimeout(() => setFocus('on'), 60); };

  if (!permission) return <Text style={s.body}>Checking camera permission…</Text>;
  if (!permission.granted) {
    return (
      <View style={s.pad}>
        <Text style={s.body}>{prompt} JalSakshi needs the camera for this.</Text>
        <Pressable style={s.btn} onPress={() => void requestPermission()} accessibilityRole="button">
          <Text style={s.btnText}>Allow camera</Text>
        </Pressable>
        <Pressable style={s.ghost} onPress={onSkip} accessibilityRole="button">
          <Text style={s.ghostText}>{skipLabel}</Text>
        </Pressable>
      </View>
    );
  }

  if (shot) {
    return (
      <View style={s.pad}>
        <Text style={s.body}>Check the photo: are the colours sharp and the whole chart visible?</Text>
        <Image source={{ uri: shot.uri }} style={s.frame} resizeMode="cover" accessibilityLabel="The photo you took" />
        <View style={s.row}>
          <Pressable style={[s.ghost, s.flex]} onPress={() => setShot(null)} accessibilityRole="button" testID="photo-retake">
            <Text style={s.ghostText}>↺ Retake</Text>
          </Pressable>
          <Pressable style={[s.btn, s.flex]} onPress={() => onPhoto({ content_type: 'image/jpeg', data_base64: shot.base64 })}
            accessibilityRole="button" testID="photo-use">
            <Text style={s.btnText}>✓ Use photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.pad}>
      <Text style={s.body}>{prompt}</Text>
      {/* Fixed height: CameraView gets no measured size from a flex-only layout. */}
      <Pressable onPress={refocus} accessibilityLabel="Camera preview. Tap to refocus.">
        <View style={s.frame}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} zoom={zoom} autofocus={focus}
            onCameraReady={() => setReady(true)} animateShutter />
          <View style={s.guide} pointerEvents="none">
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[s.corner, s[c]]} />)}
            <Text style={s.guideText}>Strip + chart inside the frame</Text>
          </View>
        </View>
      </Pressable>
      <View style={s.row}>
        <Pressable style={[s.tool, torch && s.toolOn]} onPress={() => setTorch(!torch)} accessibilityRole="switch"
          accessibilityState={{ checked: torch }} testID="photo-torch">
          <Text style={[s.toolText, torch && s.toolTextOn]}>🔦 {torch ? 'Torch on' : 'Torch'}</Text>
        </Pressable>
        {ZOOMS.map((z, i) => (
          <Pressable key={z} style={[s.tool, zoom === z && s.toolOn]} onPress={() => setZoom(z)} accessibilityRole="radio"
            accessibilityState={{ selected: zoom === z }} accessibilityLabel={`Zoom ${ZOOM_LABEL[i]}`}>
            <Text style={[s.toolText, zoom === z && s.toolTextOn]}>{ZOOM_LABEL[i]}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable style={[s.btn, (busy || !ready) && s.dim]} onPress={() => void take()} disabled={busy || !ready} accessibilityRole="button"
        testID="photo-shoot">
        <Text style={s.btnText}>{!ready ? 'Starting camera…' : busy ? 'Taking photo…' : '📷 Take photo'}</Text>
      </Pressable>
      <Pressable style={s.ghost} onPress={onSkip} accessibilityRole="button">
        <Text style={s.ghostText}>{skipLabel}</Text>
      </Pressable>
    </View>
  );
}

const C = 26;   // frame-guide corner length
const s = StyleSheet.create({
  pad: { gap: spacing.md },
  body: { ...type.body },
  frame: { height: 340, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  guide: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, margin: spacing.xl, justifyContent: 'flex-end', alignItems: 'center' },
  corner: { position: 'absolute', width: C, height: C, borderColor: '#fff' },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  guideText: { color: '#fff', fontWeight: '700', fontSize: 13, marginBottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)',
               paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  tool: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  toolOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolText: { ...type.small, color: colors.text, fontWeight: '600' },
  toolTextOn: { color: colors.onPrimary },
  error: { color: colors.alert, fontWeight: '600' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
  dim: { opacity: 0.6 },
});
