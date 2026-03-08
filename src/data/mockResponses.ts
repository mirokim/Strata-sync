import type { DirectorId } from '@/types'

/**
 * Mock AI responses per director persona.
 * Used by chatStore when real LLM integration is not yet available.
 * Selection is pseudo-random based on message content hash.
 */
export const MOCK_RESPONSES: Record<DirectorId, string[]> = {
  chief_director: [
    'From a holistic perspective, aligning goals across teams is currently the most important task. Confirm first that every department is pointing toward the same vision.',
    'Viewing this issue through the core value of Project ECHO — "a balance between immersive exploration and combat" — the priority is consistency of the player experience.',
    'This decision may slow development speed in the short term, but unifying team direction is far more important in the long run. I recommend revisiting it against milestone M4.',
    'Synthesizing feedback from the art team and the planning team, the points of conflict are clear. My view is that it is realistic for the art team to maximize expression within the functional constraints set by the planning team.',
    'The most frequently cited keyword in the Q1 retrospective was "lack of consistency." Without resolving this issue first, achieving Q2 goals will be difficult.',
    'This matter requires cross-departmental collaboration. I will add it to the agenda for the next cross-team meeting. I recommend each team prepare their position in advance.',
    'Risk analysis: proceeding in this direction has a 30% chance of schedule delay, but leaving it unaddressed carries a 60% chance of rework due to quality issues. Choosing the former is the rational call.',
    'Lesson from a similar situation in the past: making the right decision mattered more than making a fast one. Allow sufficient review time, but do not delay more than one week.',
  ],

  art_director: [
    'From a visual standpoint, the current color palette conflicts with the core T&M guide principle of "dark and mysterious atmosphere." I recommend reducing overall saturation by 20–30%.',
    'The silhouette on this asset is excellent, but the color placement is at odds with the world-building. Please revisit the palettes of the dark fantasy references we set.',
    'From an environmental art perspective, the lighting direction is not guiding the player\'s eye toward the objective. Readjusting the position and intensity of the light source should resolve this.',
    'This is a UI visual consistency issue. Having three different icon styles coexisting in the current state will confuse users. I recommend unifying everything to line icons.',
    'From a cutscene direction standpoint, the camera movement is too fast. For emotional impact, try lingering an extra 0.5–1 second on key scenes.',
    'Concept art quality has improved overall. For the next review, please increase silhouette variety — there is a current problem where the characters look too similar.',
    'The noise pattern on this texture includes high-saturation areas prohibited by the T&M guide. Fix that portion alone and the asset will be a good overall result.',
    'From an art direction standpoint, this issue is fundamentally a reference-setting problem. It is important to re-verify that the whole team is looking at the same references.',
  ],

  plan_director: [
    'Analyzing from a player-experience perspective, the reward feedback in the current core loop is too weak. The action → immediate response link needs to be strengthened.',
    'In the feature priority list, this item is rated Should. Committing resources before the current Must items are completed is not recommended.',
    'Looking at balance data, the drop-off rate spikes sharply in the level 5–8 range. Smoothing out the difficulty curve in that range is urgent.',
    'By UX flow standards, the access path for this feature is too deep. The more frequently a feature is used, the more strictly we need to uphold the 2-tap access principle.',
    'From a systems perspective, these two features have a dependency relationship. Developing the downstream feature without completing the upstream one will generate more than three times the refactoring cost.',
    'Aggregating playtest results, the most common player complaint is the absence of feedback. Adding one sound cue and one visual feedback each should resolve it.',
    'Including this feature in the Q2 scope is expected to push the schedule 2 weeks over. Consider downgrading it to Could or reducing the scope by 50%.',
    'As a game design principle, players must be able to immediately understand why they failed. The current feedback system does not satisfy this principle.',
  ],

  level_director: [
    'From a level-flow perspective, this zone is structured in a way that makes it easy for players to get lost. Placing 3 or more visual landmarks along the main path will solve it.',
    'By sight-guidance principles, this corridor appears dead-ended, making it highly likely players will give up progressing. A window or light source must be added to motivate forward movement.',
    'In terms of spatial design, the combat zone is too narrow. Comfortable combat requires securing a minimum space (15×15m) where players can move in at least 3 directions.',
    'In gimmick design, placing a Level 2 gimmick without introducing a Level 1 gimmick first will confuse players. Please follow the principle of sequential gimmick introduction.',
    'The enemy placement in this level caused problems during playtesting. When more than 3 enemies enter the player\'s field of view simultaneously, the pressure becomes excessive.',
    'The checkpoint interval is too long. Maintaining the principle of one checkpoint per three combat zones can significantly reduce player drop-off.',
    'In the fork design, there are insufficient visual cues to distinguish the main path from the side path. I recommend using a ceiling height difference to naturally differentiate them.',
    'Calculating total travel time across the level, it exceeds the target (90 seconds per zone). Shorten unnecessary sections by 30% or add movement-speed buff zones.',
  ],

  prog_director: [
    'Performance analysis results: the current GPU bottleneck is draw calls running at 2.3x the per-frame target (500). Applying GPU instancing can achieve over 70% improvement.',
    'From a tech architecture standpoint, this implementation approach may cause problems when scaling later. Applying the ECS pattern takes 2 extra days now but cuts long-term maintenance cost in half.',
    'Memory profiling results show this module is generating 10KB of GC pressure per frame. Applying object pooling will resolve it immediately.',
    'On the network latency front, the current packet size is excessive. Sending only necessary data via delta sync will reduce traffic by 60% and also improve latency.',
    'The implementation complexity of this feature is higher than expected. Implementing it within the current architecture may accumulate tech debt, so I recommend one more review at the design stage.',
    'In rendering pipeline optimization, activating TAA + SSAO simultaneously exceeds the budget. Either halve the SSAO sample count or reduce the TAA jitter intensity.',
    'Server load test results: with the current structure, response time increases sharply beyond 5,000 concurrent users. Adjusting load balancer configuration can resolve this.',
    'From a tech debt perspective, fixing this legacy code now takes 2 days, but leaving it will require more than a week of refactoring next quarter. I recommend handling it now.',
  ],
}

/**
 * Select a mock response pseudo-randomly based on message content.
 * Returns consistent responses for the same input.
 */
export function selectMockResponse(personaId: DirectorId, message: string): string {
  const responses = MOCK_RESPONSES[personaId] ?? []
  // Simple hash from message text
  let hash = 0
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) & 0xffffffff
  }
  const idx = Math.abs(hash) % responses.length
  return responses[idx]
}
