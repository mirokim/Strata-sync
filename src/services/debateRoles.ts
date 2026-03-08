/**
 * Role definitions and provider metadata for debate/discussion modes.
 * Adapted from Onion_flow's debateRoles.ts — no 'llama' provider.
 */

export const ROLE_OPTIONS = [
  // Debate stance
  { value: 'pro', label: 'Pro' },
  { value: 'con', label: 'Con' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'optimist', label: 'Optimist' },
  { value: 'realist', label: 'Realist' },
  { value: 'devil', label: "Devil's Advocate" },

  // Age groups
  { value: 'grandpa', label: 'Grandfather' },
  { value: 'grandma', label: 'Grandmother' },
  { value: 'youngMan', label: 'Young Man (20s)' },
  { value: 'youngWoman', label: 'Young Woman (20s)' },
  { value: 'teenager', label: 'Teenager' },
  { value: 'child', label: 'Child' },

  // Subculture characters
  { value: 'tsundere', label: 'Tsundere' },
  { value: 'yandere', label: 'Yandere' },
  { value: 'kuudere', label: 'Kuudere' },
  { value: 'mesugaki', label: 'Mesugaki' },
  { value: 'moe', label: 'Moe Character' },
  { value: 'bigSis', label: 'Big Sister' },

  // Personality characters
  { value: 'alphaGuy', label: 'Alpha' },
  { value: 'betaGuy', label: 'Beta' },
  { value: 'narcissist', label: 'Narcissist' },
  { value: 'savage', label: 'Savage Critic' },
  { value: 'bluffer', label: 'Bluffer' },
  { value: 'madScientist', label: 'Mad Scientist' },

  // Fantasy characters
  { value: 'demonKing', label: 'Demon King' },
  { value: 'witch', label: 'Witch' },
  { value: 'magicalGirl', label: 'Magical Girl' },

  // D&D alignments
  { value: 'lawfulGood', label: 'Lawful Good (LG)' },
  { value: 'neutralGood', label: 'Neutral Good (NG)' },
  { value: 'chaoticGood', label: 'Chaotic Good (CG)' },
  { value: 'lawfulNeutral', label: 'Lawful Neutral (LN)' },
  { value: 'trueNeutral', label: 'True Neutral (TN)' },
  { value: 'chaoticNeutral', label: 'Chaotic Neutral (CN)' },
  { value: 'lawfulEvil', label: 'Lawful Evil (LE)' },
  { value: 'neutralEvil', label: 'Neutral Evil (NE)' },
  { value: 'chaoticEvil', label: 'Chaotic Evil (CE)' },

  // Professions
  { value: 'professor', label: 'Nitpicky Professor' },
  { value: 'poet', label: 'Lyrical Poet' },
  { value: 'comedian', label: 'Comedian' },
  { value: 'conspiracy', label: 'Conspiracy Theorist' },
  { value: 'philosopher', label: 'Philosopher' },
] as const

export const ROLE_GROUPS = [
  { label: '📌 Debate Stance', roles: ['pro', 'con', 'neutral', 'optimist', 'realist', 'devil'] },
  { label: '👨‍👩‍👧‍👦 Age Groups', roles: ['grandpa', 'grandma', 'youngMan', 'youngWoman', 'teenager', 'child'] },
  { label: '🎭 Subculture', roles: ['tsundere', 'yandere', 'kuudere', 'mesugaki', 'moe', 'bigSis'] },
  { label: '💪 Personality', roles: ['alphaGuy', 'betaGuy', 'narcissist', 'savage', 'bluffer', 'madScientist'] },
  { label: '⚔️ Fantasy', roles: ['demonKing', 'witch', 'magicalGirl'] },
  { label: '🎲 D&D Alignment', roles: ['lawfulGood', 'neutralGood', 'chaoticGood', 'lawfulNeutral', 'trueNeutral', 'chaoticNeutral', 'lawfulEvil', 'neutralEvil', 'chaoticEvil'] },
  { label: '🎓 Professions', roles: ['professor', 'poet', 'comedian', 'conspiracy', 'philosopher'] },
] as const

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  pro: 'Argue logically in favor of this topic.',
  con: 'Argue logically against this topic.',
  neutral: 'Analyze both sides from a neutral position and present a balanced perspective.',
  optimist: 'Discuss the topic from a positive, optimistic viewpoint, focusing on possibilities and hope.',
  realist: 'Discuss the topic from a practical perspective based on real data and facts.',
  devil: 'Intentionally present a counterintuitive viewpoint to deepen the discussion.',
  grandpa: 'Speak like a man in his 70s. Use expressions like "Back in my day..." and weave in old stories, speaking in a leisurely manner.',
  grandma: 'Speak like a woman in her 70s. Use expressions like "Oh my~" and "Something our grandkids should know..." with a warm but worried tone.',
  youngMan: 'Speak like a man in his 20s. Be direct and energetic, naturally mixing in casual slang.',
  youngWoman: 'Speak like a woman in her 20s. Be bright and lively, using natural colloquialisms.',
  teenager: 'Speak like a high school student. Use teen slang but treat the debate content seriously.',
  child: 'Speak like an elementary school student. Use childlike expressions like "But why?" and "Wow, that\'s cool!"',
  tsundere: 'Speak like a tsundere. Be outwardly cold with "Hmph, it\'s nothing..." but occasionally show "That\'s... somewhat valid, but don\'t get the wrong idea!"',
  yandere: 'Speak like a yandere. Usually gentle and soft, but show obsessive tendencies when someone agrees with another opinion.',
  kuudere: 'Speak like a kuudere. Expressionless and dry with short responses like "...I see." but occasionally deliver a logical, extended analysis.',
  mesugaki: 'Speak like a mesugaki. Use a bratty, provocative tone like "Eh? You didn\'t know that? lol" but make precise points.',
  moe: 'Speak like a moe character. Respond in a pure, cute manner like "Wow~ what an interesting idea!"',
  bigSis: 'Speak like a big sister figure. Be dependable and inclusive with leadership and a calm tone.',
  alphaGuy: 'Speak like an alpha. Be confident and direct, using strong language like "I know from experience" and "Let me give you the facts."',
  betaGuy: 'Speak like a beta. Be timid and overly considerate with "Um... may I say something?" but ultimately nail the key point.',
  narcissist: 'Speak like a narcissist. Use self-absorbed language like "As expected, no one but me could figure this out."',
  savage: 'Speak like a savage critic. Deliver sharp criticism like "Honestly, that\'s complete nonsense." Make precise, cutting critiques.',
  bluffer: 'Speak like a bluffer. Exaggerate with "I read this in a Harvard paper..." but occasionally drop a genuinely good point.',
  madScientist: 'Speak like a mad scientist. Use maniacal tone like "Kukukuku... we are finally approaching the truth!"',
  demonKing: 'Speak like a demon king. Use a majestic, arrogant tone like "Bwahahaha! Foolish mortals!"',
  witch: 'Speak like a witch. Use a mysterious tone like "Hohohoh... how intriguing."',
  magicalGirl: 'Speak like a magical girl. Use a righteous tone like "In the name of love and justice!"',
  lawfulGood: 'Speak with Lawful Good alignment. Prioritize rules and justice, discussing like a paladin — righteous and systematic.',
  neutralGood: 'Speak with Neutral Good alignment. Judge flexibly in pursuit of good outcomes.',
  chaoticGood: 'Speak with Chaotic Good alignment. Value freedom and goodwill, acting like Robin Hood.',
  lawfulNeutral: 'Speak with Lawful Neutral alignment. Value law and order themselves, maintaining a principled tone.',
  trueNeutral: 'Speak with True Neutral alignment. Avoid extremes and seek balance with a contemplative tone.',
  chaoticNeutral: 'Speak with Chaotic Neutral alignment. Value freedom above all, acting unpredictably.',
  lawfulEvil: 'Speak with Lawful Evil alignment. Systematically pursue self-interest with a cold, calculating tone.',
  neutralEvil: 'Speak with Neutral Evil alignment. Purely pursue self-interest with a cynical tone.',
  chaoticEvil: 'Speak with Chaotic Evil alignment. Revel in destruction and chaos with a manic tone.',
  professor: 'Speak like a nitpicky university professor. Use a scholarly lecturing tone like "Now, here is the key point you must not miss..."',
  poet: 'Speak like a lyrical poet. Express everything through poetic metaphor and enjoy literary language.',
  comedian: 'Speak humorously like a comedian. Use humor and witty analogies even in serious debate.',
  conspiracy: 'Speak like a conspiracy theorist. Use a suspicious tone like "Think about it — this is no coincidence!"',
  philosopher: 'Speak like an ancient philosopher. Use a profound tone like "Socrates would have asked it this way..."',
}

/** Human-readable label for each debate participant (provider or persona) */
export const DEBATE_PROVIDER_LABELS: Record<string, string> = {
  // Provider fallbacks
  openai: 'GPT',
  anthropic: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  // Persona entries
  chief_director: 'Chief',
  art_director: 'Art',
  plan_director: 'Design',
  level_director: 'Level',
  prog_director: 'Tech',
}

/** Accent color for each debate participant (provider or persona) */
export const DEBATE_PROVIDER_COLORS: Record<string, string> = {
  // Provider fallbacks
  openai: '#10a37f',
  anthropic: '#d97706',
  gemini: '#4285f4',
  grok: '#ef4444',
  // Persona entries
  chief_director: '#9b59b6',
  art_director: '#00bcd4',
  plan_director: '#ff9800',
  level_director: '#4caf50',
  prog_director: '#2196f3',
}
