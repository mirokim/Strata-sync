import { DEFAULT_FAST_MODEL_ID } from '@/lib/modelConfig'

// ── MiroFish Simulator Types ─────────────────────────────────────────────────

export interface MirofishPersona {
  id: string
  name: string
  role: string
  stance: 'supportive' | 'opposing' | 'neutral' | 'observer'
  /** 0.0–1.0: probability of responding each round */
  activityLevel: number
  /** LLM system prompt — defines this persona's perspective and tone */
  systemPrompt: string
  /** Social influence (0.1–1.0) — reflected in reports */
  influenceWeight: number
}

export interface MirofishPost {
  round: number
  personaId: string
  personaName: string
  stance: MirofishPersona['stance']
  /** Whether stance changed compared to previous round */
  stanceShifted?: boolean
  /** Stance before the shift */
  prevStance?: MirofishPersona['stance']
  content: string
  /** Emotion intensity 1-5 (1=mild, 5=very intense) */
  intensity?: number
  timestamp: number
  // OASIS fields
  postId?: string
  actionType?: 'post' | 'repost' | 'like' | 'follow' | 'do_nothing'
  originalPostId?: string
  likes?: number
  reposts?: number
}

export interface MirofishSimulationConfig {
  topic: string
  numPersonas: number         // 3–50
  numRounds: number           // 2–10
  modelId: string
  autoGeneratePersonas: boolean
  /** When Slack images are attached, pass them directly to each persona LLM (true) vs convert to text description (false) */
  imageDirectPass: boolean
  personas: MirofishPersona[]
  /** RAG-retrieved vault background information — injected into persona prompts */
  context?: string
  /** Direct-pass images — attached to each persona LLM call */
  images?: Array<{ data: string; mediaType: string }>
}

export type SimulationStatus =
  | 'idle'
  | 'generating-personas'
  | 'running'
  | 'generating-report'
  | 'done'
  | 'error'

export interface MirofishSimulationState {
  status: SimulationStatus
  currentRound: number
  totalRounds: number
  feed: MirofishPost[]
  /** Currently streaming post content (personaId -> partial content) */
  streamingPost: { personaId: string; content: string } | null
  report: string
  errorMessage?: string
}

export const DEFAULT_PERSONAS: MirofishPersona[] = [
  {
    id: 'skeptic',
    name: 'Skeptic',
    role: 'critical analyst',
    stance: 'opposing',
    activityLevel: 0.8,
    influenceWeight: 0.7,
    systemPrompt:
      'You are a cautious skeptic. You critically review new ideas or products, ' +
      'pointing out potential risks or downsides. Express your opinion concisely in 2-3 sentences.',
  },
  {
    id: 'enthusiast',
    name: 'Early Adopter',
    role: 'early adopter',
    stance: 'supportive',
    activityLevel: 0.9,
    influenceWeight: 0.6,
    systemPrompt:
      'You are an enthusiastic early adopter. You react quickly and positively to new technology ' +
      'and trends. Mention specific use scenarios and express your opinion in 2-3 sentences.',
  },
  {
    id: 'pragmatist',
    name: 'Pragmatist',
    role: 'pragmatic evaluator',
    stance: 'neutral',
    activityLevel: 0.6,
    influenceWeight: 0.8,
    systemPrompt:
      'You are a pragmatic evaluator. You provide balanced opinions focused on cost-effectiveness ' +
      'and real-world applicability. Express your opinion concisely in 2-3 sentences.',
  },
  {
    id: 'influencer',
    name: 'Influencer',
    role: 'social media influencer',
    stance: 'supportive',
    activityLevel: 0.7,
    influenceWeight: 0.9,
    systemPrompt:
      'You are a social media influencer. You are trend-sensitive, mindful of follower reactions, ' +
      'and express opinions in an emotional and empathetic way. Express your opinion in 2-3 sentences.',
  },
  {
    id: 'expert',
    name: 'Domain Expert',
    role: 'domain expert',
    stance: 'neutral',
    activityLevel: 0.5,
    influenceWeight: 1.0,
    systemPrompt:
      'You are a domain expert. You provide in-depth analysis based on technical accuracy ' +
      'and industry standards. Use appropriate technical terminology and express your opinion in 2-3 sentences.',
  },
]

export interface MirofishPersonaPreset {
  id: string
  name: string
  personas: MirofishPersona[]
}

export interface MirofishScheduledTopic {
  id: string
  topic: string
  numPersonas: number
  numRounds: number
  /** HH:MM format — auto-runs at this time daily */
  time: string
  enabled: boolean
}

export interface MirofishHistoryEntry {
  id: string
  topic: string
  numPersonas: number
  numRounds: number
  feed: MirofishPost[]
  report: string
  createdAt: number  // timestamp ms
}

export const DEFAULT_CONFIG: MirofishSimulationConfig = {
  topic: '',
  numPersonas: 5,
  numRounds: 5,
  modelId: DEFAULT_FAST_MODEL_ID,
  autoGeneratePersonas: true,
  imageDirectPass: true,
  personas: DEFAULT_PERSONAS,
}
