/**
 * Shared design tokens for the two JalSakshi app surfaces.
 *
 * Derived from the supplied product mockups: soft blue water palette, white
 * cards on a tinted background, generous rounding, status colours that are
 * consistent between the worker and community apps.
 *
 * ## One rule the palette must not break
 *
 * Green here means "within the tested limits of a VERIFIED LAB REPORT", never
 * "safe to drink". A colour is a very strong claim to a worried reader, so the
 * status words that accompany these colours are constrained in
 * `statusLabel.ts`, not chosen freely per screen.
 */

export const colors = {
  // Surfaces
  bg: '#F0F7FF',
  bgDeep: '#E3F0FB',
  card: '#FFFFFF',
  cardAlt: '#F8FBFF',
  border: '#DCE9F5',
  borderStrong: '#C3DCEF',

  // Brand
  primary: '#1D6FD0',
  primaryDark: '#14507D',
  primarySoft: '#E8F2FC',
  accent: '#3B82F6',

  // Text
  text: '#0F2942',
  textMuted: '#5A7387',
  textFaint: '#8AA2B4',
  onPrimary: '#FFFFFF',

  // Status. Names describe the RECORD, not the water.
  ok: '#0E9F6E',
  okSoft: '#E6F6F0',
  watch: '#C77700',
  watchSoft: '#FDF3E3',
  alert: '#C2321F',
  alertSoft: '#FCEBE8',
  unknown: '#5A7387',
  unknownSoft: '#EEF3F7',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const type = {
  h1: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12.5, color: colors.textMuted },
  tiny: { fontSize: 11.5, color: colors.textFaint },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F2942',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
