import type { SpeakerId } from '@/types'

export interface SpeakerMeta {
  label: string
  /** CSS hex color string */
  color: string
  /** Three.js hex number */
  hex: number
  /** Dark background for folder/chip */
  darkBg: string
  /** Short description */
  role: string
}

export const SPEAKER_CONFIG: Record<SpeakerId, SpeakerMeta> = {
  chief_director: {
    label: 'STRATA BOT',
    color: '#38bdf8',
    hex: 0x38bdf8,
    darkBg: '#0c2233',
    role: 'Knowledge assistant · vault search · analysis',
  },
  art_director: {
    label: 'Art',
    color: '#00bcd4',
    hex: 0x00bcd4,
    darkBg: '#003d45',
    role: 'Visual quality · tone & manner · color',
  },
  plan_director: {
    label: 'Design',
    color: '#ff9800',
    hex: 0xff9800,
    darkBg: '#3d2000',
    role: 'Gameplay · systems · schedule · priorities',
  },
  level_director: {
    label: 'Level',
    color: '#4caf50',
    hex: 0x4caf50,
    darkBg: '#0d2e0d',
    role: 'Level flow · sightline guidance · gimmicks · layout',
  },
  prog_director: {
    label: 'Tech',
    color: '#2196f3',
    hex: 0x2196f3,
    darkBg: '#0d1f3c',
    role: 'Optimization · performance · stability · technical architecture',
  },
  unknown: {
    label: 'Unclassified',
    color: '#888888',
    hex: 0x888888,
    darkBg: '#1e1e1e',
    role: 'Unclassified documents',
  },
}

/** The 5 named director IDs (excludes 'unknown') — use for persona UI */
export const SPEAKER_IDS = [
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
] as const satisfies SpeakerId[]
