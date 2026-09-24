import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  confirmSuggestion,
  MANUAL_REASON_MAX_LENGTH,
  recordManualInterpretation,
  type ReviewAnalysis,
  type ReviewBin,
  type ReviewObservation,
} from './analysis/baseline';

export interface ReviewScreenProps {
  analysis: ReviewAnalysis;
  bins: readonly ReviewBin[];
  onComplete(observation: ReviewObservation): void;
  onRetake(): void;
}

const REASON_TEXT: Record<string, string> = {
  features_unavailable: 'The camera result is unavailable.',
  features_invalid: 'The captured features are invalid.',
  profile_unavailable: 'No kit comparison profile is available.',
  profile_invalid: 'The kit comparison profile is invalid.',
  quality_uncertain: 'Capture quality needs human review.',
  quality_retake: 'Capture quality is too low to interpret.',
  timing_invalid: 'The prescribed read time could not be verified.',
};

export function ReviewScreen({ analysis, bins, onComplete, onRetake }: ReviewScreenProps): React.JSX.Element {
  const [manual, setManual] = useState(analysis.status === 'manual_required');
  const [selectedBin, setSelectedBin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submitManual = () => {
    try {
      onComplete(recordManualInterpretation(analysis, bins, selectedBin, reason));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the manual interpretation.');
    }
  };

  if (analysis.status === 'retake') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>Indicative screening</Text>
        <Text style={styles.title}>Take another photo</Text>
        <Text style={styles.body}>{REASON_TEXT[analysis.reason ?? ''] ?? 'The capture cannot be interpreted.'}</Text>
        {analysis.qualityReasons.map((item) => <Text key={item} style={styles.reason}>• {item.replaceAll('_', ' ')}</Text>)}
        <Pressable style={styles.primary} onPress={onRetake} accessibilityRole="button">
          <Text style={styles.primaryText}>Retake photo</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Indicative screening</Text>
      <Text style={styles.title}>Review the kit reading</Text>
      <View style={styles.boundary} accessibilityLiveRegion="polite">
        <Text style={styles.boundaryTitle}>Screening result only</Text>
        <Text style={styles.body}>This is not a complete water-safety assessment. Follow the programme's next steps.</Text>
      </View>

      {analysis.status === 'suggested' && !manual && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Experimental suggestion</Text>
          <Text style={styles.binLabel}>{bins.find((bin) => bin.key === analysis.machineBin)?.label ?? analysis.machineBin}</Text>
          <Text style={styles.meta}>Profile {analysis.baselineVersion} · protocol {analysis.protocolVersion}</Text>
          {analysis.researchOnly && <Text style={styles.warning}>Research profile — not approved for operational use.</Text>}
          <Pressable style={styles.primary} onPress={() => onComplete(confirmSuggestion(analysis))} accessibilityRole="button">
            <Text style={styles.primaryText}>Confirm this reading</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setManual(true)} accessibilityRole="button">
            <Text style={styles.secondaryText}>Enter a different reading</Text>
          </Pressable>
        </View>
      )}

      {analysis.status === 'manual_required' && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeTitle}>Enter the kit reading manually</Text>
          <Text style={styles.body}>{REASON_TEXT[analysis.reason ?? ''] ?? 'No assisted suggestion is available.'}</Text>
          {analysis.qualityReasons.map((item) => <Text key={item} style={styles.reason}>• {item.replaceAll('_', ' ')}</Text>)}
        </View>
      )}

      {manual && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reading shown on the kit</Text>
          <View style={styles.binList} accessibilityRole="radiogroup">
            {bins.map((bin) => {
              const selected = selectedBin === bin.key;
              return (
                <Pressable
                  key={bin.key}
                  style={[styles.bin, selected && styles.binSelected]}
                  onPress={() => { setSelectedBin(bin.key); setError(''); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.binText, selected && styles.binTextSelected]}>{bin.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Reason for manual entry</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={(value) => { setReason(value); setError(''); }}
            placeholder="For example, the card looked closer to this bin"
            multiline
            maxLength={MANUAL_REASON_MAX_LENGTH}
            accessibilityLabel="Reason for manual entry"
          />
          {error ? <Text style={styles.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
          <Pressable style={styles.primary} onPress={submitManual} accessibilityRole="button">
            <Text style={styles.primaryText}>Use manual reading</Text>
          </Pressable>
          {analysis.status === 'suggested' && (
            <Pressable style={styles.secondary} onPress={() => { setManual(false); setError(''); }} accessibilityRole="button">
              <Text style={styles.secondaryText}>Back to suggestion</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, backgroundColor: '#F5F4EE' },
  eyebrow: { color: '#42606A', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#0B2831', fontSize: 26, fontWeight: '800' },
  body: { color: '#374F57', fontSize: 15, lineHeight: 22 },
  boundary: { backgroundColor: '#FFF4E6', borderLeftColor: '#A33825', borderLeftWidth: 4, padding: 14, gap: 4 },
  boundaryTitle: { color: '#7D281B', fontSize: 17, fontWeight: '800' },
  section: { backgroundColor: '#FFFFFF', borderColor: '#D9DDD8', borderWidth: 1, borderRadius: 10, padding: 16, gap: 12 },
  sectionTitle: { color: '#0B2831', fontSize: 18, fontWeight: '800' },
  binLabel: { color: '#0F6B67', fontSize: 28, fontWeight: '800' },
  meta: { color: '#53666C', fontSize: 13 },
  warning: { color: '#7D281B', fontSize: 14, fontWeight: '700' },
  notice: { backgroundColor: '#E7F3F1', padding: 14, gap: 4 },
  noticeTitle: { color: '#0B2831', fontSize: 17, fontWeight: '800' },
  reason: { color: '#603B32', fontSize: 14 },
  binList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bin: { minHeight: 48, minWidth: 64, borderColor: '#AEBAB7', borderWidth: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  binSelected: { backgroundColor: '#0F6B67', borderColor: '#0F6B67' },
  binText: { color: '#0B2831', fontSize: 16, fontWeight: '700' },
  binTextSelected: { color: '#FFFFFF' },
  label: { color: '#0B2831', fontSize: 15, fontWeight: '700' },
  input: { minHeight: 72, borderColor: '#AEBAB7', borderWidth: 1, borderRadius: 8, padding: 12, color: '#0B2831', fontSize: 16, backgroundColor: '#FAFAF7', textAlignVertical: 'top' },
  error: { color: '#A33825', fontSize: 14, fontWeight: '700' },
  primary: { minHeight: 48, backgroundColor: '#0F6B67', borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  secondary: { minHeight: 48, borderColor: '#0F6B67', borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { color: '#0F6B67', fontSize: 15, fontWeight: '700' },
});
