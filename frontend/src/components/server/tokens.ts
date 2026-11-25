export const MONO = 'var(--font-mono)'

/** Semantic colour of a status; maps onto the MUI palette (`default` = neutral). */
export type Tone = 'success' | 'warning' | 'error' | 'info' | 'primary' | 'default'

export const toneColor = (tone: Tone) => (tone === 'default' ? 'text.secondary' : `${tone}.main`)
