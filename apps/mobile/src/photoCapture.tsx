/**
 * Take one photo for upload (Pluccy's proof photo, a resident's complaint
 * photo). JPEG at reduced quality so it stays well under the server's 10 MiB
 * cap; the server still checks the file signature and size itself.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';
import type { Photo } from './v2';

export function PhotoCapture({ prompt, onPhoto, onSkip, skipLabel }: {
  prompt: string;
  onPhoto(photo: Photo): void;
  onSkip(): void;
  skipLabel: string;
}): React.JSX.Element {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shoot = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.current.takePictureAsync({ base64: true, quality: 0.5, exif: false });
      if (!shot?.base64) throw new Error('no image data');
      onPhoto({ content_type: 'image/jpeg', data_base64: shot.base64 });
    } catch {
      setError('The photo could not be taken. Try again.');
    } finally {
      setBusy(false);
    }
  };

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
  return (
    <View style={s.pad}>
      <Text style={s.body}>{prompt}</Text>
      {/* Fixed height: CameraView gets no measured size from a flex-only layout. */}
      <CameraView ref={camera} style={s.camera} facing="back" />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable style={[s.btn, busy && s.dim]} onPress={() => void shoot()} disabled={busy} accessibilityRole="button"
        testID="photo-shoot">
        <Text style={s.btnText}>{busy ? 'Taking photo…' : 'Take photo'}</Text>
      </Pressable>
      <Pressable style={s.ghost} onPress={onSkip} accessibilityRole="button">
        <Text style={s.ghostText}>{skipLabel}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  pad: { gap: spacing.md },
  body: { ...type.body },
  camera: { height: 320, borderRadius: radius.md, overflow: 'hidden' },
  error: { color: colors.alert, fontWeight: '600' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
  dim: { opacity: 0.6 },
});
