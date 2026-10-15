/**
 * Política de cor (docs/08-holograma.md, seção 8.4): prateado é o normal;
 * cor só aparece quando há risco (âmbar = precisa de você; vermelho = bloqueado).
 */
export const palette = {
  core: '#FFFFFF',
  silver: '#D3DCE6',
  silverDark: '#8693A2',
  background: '#04060A',
  amber: '#F0AD4A',
  red: '#FF5B52',
  /** Cinza do modo offline e do "chiado" de contaminação. */
  gray: '#5D646D',
} as const;

export type PaletteColor = keyof typeof palette;
