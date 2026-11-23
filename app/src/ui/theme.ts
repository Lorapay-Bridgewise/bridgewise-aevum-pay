/**
 * The Aevum Pay look, from the redesign canvas: warm paper ground, deep green for money and
 * trust, amber for "on its way", red only for things that failed. Text colours pass 4.5:1 on
 * the ground and on white.
 */
export const colors = {
  bg: '#F6F4EE',
  card: '#FFFFFF',
  ink: '#14201A',
  body: '#33413A',
  muted: '#5B665F',
  faint: '#9AA39D',
  line: '#E3E0D6',
  lineSoft: '#EEEBE3',
  green: '#0F7A4A',
  greenDark: '#0A5C37',
  deep: '#0F3D2A',
  mint: '#E8F2EC',
  paidSoft: '#E2F1E8',
  onDeep: '#E4F0E9',
  onDeepMuted: '#CFE3D8',
  amberText: '#8A4B07',
  amberSoft: '#FBEBD3',
  red: '#B42318',
  redSoft: '#FBE4E1',
  camera: '#0B0F0D',
  scrim: 'rgba(20, 32, 26, 0.45)',
};

/**
 * Bundled fonts (android/app/src/main/assets/fonts, SIL Open Font License). On Android each
 * weight is its own family name, so weight is chosen by family, never by fontWeight.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',
};

export const space = (n: number) => n * 4;

export const radius = { sm: 12, md: 16, lg: 18, xl: 24, sheet: 28, pill: 999 };

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: colors.ink, letterSpacing: -0.5 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: colors.ink },
  h2: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.body },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  money: { fontFamily: fonts.display, color: colors.ink, fontVariant: ['tabular-nums' as const] },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.ink },
};
