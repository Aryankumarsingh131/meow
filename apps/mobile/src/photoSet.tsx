/**
 * Several photos (default up to 4): thumbnails with remove, and "Add a photo"
 * opens the camera (photoCapture.tsx) for one more. The first photo is the one
 * the server treats as the main photo; the rest go as extra_photos (011).
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { PhotoCapture } from './photoCapture';
import { colors, radius, spacing, type } from './theme';
import type { Photo } from './v2';

export const MAX_PHOTOS = 4;

/** The request fields for a list of photos: first as `photo`, the rest as `extra_photos`. */
export const photoFields = (photos: Photo[]): { photo?: Photo; extra_photos?: Photo[] } =>
  photos.length ? { photo: photos[0], ...(photos.length > 1 ? { extra_photos: photos.slice(1, MAX_PHOTOS) } : {}) } : {};

export function PhotoSet({ photos, onChange, prompt, max = MAX_PHOTOS }: {
  photos: Photo[];
  onChange(photos: Photo[]): void;
  prompt: string;
  max?: number;
}): React.JSX.Element {
  const [camera, setCamera] = useState(false);
  if (camera) {
    return (
      <PhotoCapture prompt={`${prompt} (photo ${photos.length + 1} of up to ${max})`}
        onPhoto={(p) => { onChange([...photos, p].slice(0, max)); setCamera(false); }}
        onSkip={() => setCamera(false)} skipLabel="Cancel" />
    );
  }
  return (
    <View style={s.wrap}>
      <View style={s.grid}>
        {photos.map((p, i) => (
          <View key={i} style={s.thumbBox}>
            <Image source={{ uri: `data:${p.content_type};base64,${p.data_base64}` }} style={s.thumb} accessibilityLabel={`Photo ${i + 1}`} />
            {i === 0 && <Text style={s.main}>Main</Text>}
            <Pressable style={s.remove} onPress={() => onChange(photos.filter((_, j) => j !== i))} accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`} hitSlop={8} testID={`photo-remove-${i}`}>
              <Text style={s.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {photos.length < max && (
          <Pressable style={[s.thumbBox, s.add]} onPress={() => setCamera(true)} accessibilityRole="button" testID="photo-add">
            <Text style={s.addIcon}>＋</Text>
            <Text style={s.addText}>{photos.length ? 'Add another' : 'Add a photo'}</Text>
          </Pressable>
        )}
      </View>
      <Text style={s.count}>{photos.length} of {max} photos</Text>
    </View>
  );
}

const SIZE = 92;
const s = StyleSheet.create({
  wrap: { gap: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbBox: { width: SIZE, height: SIZE, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bgDeep },
  thumb: { width: '100%', height: '100%' },
  main: { position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, fontWeight: '700',
          paddingHorizontal: 5, borderRadius: 4 },
  remove: { position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  add: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary, alignItems: 'center', justifyContent: 'center',
         backgroundColor: colors.primarySoft },
  addIcon: { fontSize: 24, color: colors.primary, fontWeight: '700' },
  addText: { fontSize: 11, color: colors.primary, fontWeight: '700' },
  count: { ...type.small },
});
