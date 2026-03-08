import { useMemo, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'

const QUICK_QUESTIONS = [
  // Tech & Performance
  'What is the biggest technical bottleneck right now?',
  'Can you summarize the current performance optimization status?',
  'Are there any framerate issues in specific sections?',
  'Is memory usage within the target range?',
  'Are there any issues with the build pipeline?',
  'Which items in the technical debt need immediate attention?',
  'Are there recurring patterns in crash reports?',
  'Are there integration issues with external middleware or SDKs?',
  'How can we reduce loading times?',
  'Where is there room to optimize draw calls?',
  'Are there sections where shader compilation hitches occur?',
  'Are there any anomalies in physics simulation performance?',
  'Is network latency affecting gameplay?',
  'What is causing editor build times to grow too long?',
  'Where are the hotspots in the profiler results?',

  // QA & Bugs
  'Which unresolved bugs have the highest priority right now?',
  'What are the key issues recently discovered in QA?',
  'What bug types have the highest reproduction frequency?',
  'Which areas have insufficient regression test coverage?',
  'Are there platform-specific bugs being reported?',
  'Are there systems with inadequate edge-case handling?',

  // Gameplay & Design
  'Which areas of gameplay balance need adjustment?',
  'What level design improvements are needed?',
  'How can we improve the player onboarding experience?',
  'Are there balance issues in the in-game economy?',
  'Is enemy AI behavior working as intended?',
  'Does the difficulty curve feel as intended?',
  'Are there sections where players get stuck?',
  'Is the core game loop fun enough?',
  'Does the reward system maintain player motivation well?',
  'What is the feedback on controls and feel?',
  'Is there feedback that the camera behavior is uncomfortable?',
  'Are skill/item synergies well-designed?',
  'Does the tutorial teach the core mechanics sufficiently?',
  'Is the game session length appropriate?',

  // Art & Visuals
  'What is the latest feedback on art direction?',
  'What is the current state of character animation quality?',
  'What improvements are needed in cutscenes or cinematics?',
  'Is the detail level of environment art meeting targets?',
  'Is VFX effectively conveying gameplay feedback?',
  'Is lighting capturing the intended atmosphere?',
  'Is UI visuals consistent with the overall art style?',
  'Does the color palette look good on target platform displays?',

  // UI/UX
  'Is there feedback that UI/UX is confusing?',
  'Are accessibility features ready?',
  'Is there too much or too little information in the HUD?',
  'Is inventory/menu navigation intuitive?',
  'Is font readability acceptable at all resolutions?',
  'Are controller and keyboard UI experiences equivalent?',

  // Sound & Music
  'Is the sound design direction well-aligned?',
  'Are sound effects well-synchronized with actions?',
  'Does the BGM support the game atmosphere?',
  'Are there any audio mixing balance issues?',
  'What is the status of voice-over recording?',

  // Narrative & Story
  'Are there narrative consistency issues?',
  'Does the dialogue tone match character personalities?',
  'Does the story pacing engage players well?',
  'Are world-building details conveyed sufficiently?',
  'Is the ending likely to meet player expectations?',

  // Project Management
  "Please prioritize this milestone's deliverables.",
  'Are there cross-team alignment issues?',
  'What were the key decisions from recent team meetings?',
  'Which tasks are delayed due to resource (time/people) shortages?',
  'Which areas should we focus on in the next sprint?',
  'Which development items currently carry the highest risk?',
  'Are there features in the current scope that can be cut?',
  'Are there missing items on the pre-launch checklist?',
  'Is the code review process running smoothly?',
  'Is the milestone schedule realistically achievable?',
  'Is communication with contractors or partners smooth?',
  'What issues became blockers this week?',

  // Player & Data
  'What are the recurring complaints in player feedback?',
  'Are there notable outliers in data analytics metrics?',
  'What factors are affecting user retention?',
  'Where do players drop off most frequently?',
  'What insights came out of A/B test results?',
  'What were the common reactions during playtesting sessions?',
  'Are there changes in review/rating trends?',

  // Multiplayer & Server
  'Have multiplayer synchronization issues been reported?',
  'What is the server stability and uptime status?',
  'Is the anti-cheat/anti-hack system working effectively?',
  'What is the feedback on matchmaking quality?',
  'Is server scaling prepared for sudden spikes in concurrent users?',

  // Launch & Marketing
  'What is the status of store page and marketing materials?',
  'Is platform certification (TRC/TCR) preparation ready?',
  'What is the progress on localization?',
  'Are there any changes to the launch timing strategy?',
  'Are press kit and media materials ready?',
  'What is the plan for patch notes and community announcements?',

  // Innovation & Improvement
  'Which ideas still need validation at the prototype stage?',
  'Which current stage has the lowest level of completion?',
  'Is the differentiator versus competitor games clearly defined?',
  'Are there moments players will remember for a long time?',
  'What is the strongest hook in the current game?',
  'Which tasks in the development workflow can be automated?',
  'What is the highest-impact change for the next update?',

  // Tech & Performance (extended)
  'Are there object groups that can benefit from GPU instancing?',
  'Is LOD transition distance configured optimally?',
  'Are there scenes where occlusion culling is working properly?',
  'Does the asset streaming strategy fit within memory budgets?',
  'Are there sections with GC (garbage collection) spikes?',
  'Is thread utilization optimized?',
  'Are texture compression formats set correctly for target platforms?',
  'Are there hitches caused by runtime shader swaps?',
  'Are there unnecessary collision checks in physics layer settings?',
  'Is the maximum particle count budget maintained for particle systems?',
  'Is animation compression configured optimally?',
  'Is the audio streaming vs pre-load classification correct?',
  'Is navigation mesh update cost not excessive?',
  'Are there ways to reduce loading spikes during scene transitions?',
  'Which systems need object pools due to continuous allocate/deallocate cycles?',

  // QA & Bugs (extended)
  'Are there core flows not covered by automated testing?',
  'Does the same bug reproduce differently across multiple platforms?',
  'Are there state mismatch bugs occurring during save/load?',
  'Are there layout issues on multi-monitor or non-standard resolutions?',
  'Are there sufficient debug cheat codes for reproducing bugs?',
  'What issues came out of stress test (extended play) results?',
  'What is the oldest unresolved issue in the bug tracking system?',
  'Are there required fixes requested by the publishing partner?',
  'Are there soft bugs that ruin the game experience without causing crashes?',
  'Are there behavioral differences between test builds and release builds?',

  // Gameplay & Design (extended)
  'Does dying/failing feel motivating rather than frustrating?',
  'Do player choices produce meaningful consequences?',
  'Is the gap between skill ceiling and skill floor appropriate?',
  'Is the feedback for core verbs (jump, attack, dodge) clear?',
  'Are in-game objectives always clearly presented to the player?',
  'Are there elements that maintain freshness on repeated playthroughs?',
  'Can social play or sharing elements drive virality?',
  'Are save point frequencies placed appropriately without frustration?',
  'Do boss fights follow a learn → master → reward structure?',
  'In an open world, is the exploration motivation sufficient?',
  'Does puzzle difficulty escalate logically?',
  'Is a non-violent playstyle supported?',
  'Are emergent interactions between systems intentionally designed?',
  'Is there room for players to express their own playstyle?',
  'Are pacing adjustment sections distributed sufficiently throughout?',
  'Is the sense of contribution equal for all players in co-op?',
  'Is the price point appropriate relative to content volume?',
  'Are there elements that incentivize multiple playthroughs?',
  'Are there irreversible elements players could accidentally delete/consume?',
  'Is controller vibration (haptic feedback) utilized appropriately?',

  // Art & Visuals (extended)
  'Is the gap between concept art and final in-game visuals too large?',
  'Are character silhouettes distinguishable from a distance?',
  'Are PBR material settings showing consistent lighting response?',
  'Are particle effects sufficiently impressive within the performance budget?',
  'Is the intensity of post-process effects (chromatic aberration, vignette) excessive?',
  'Is character facial animation expressive enough?',
  'Has the team aligned on stylized vs. realistic art direction?',
  'Are asset naming conventions and folder structures consistently maintained?',
  'Does environment design naturally convey the game narrative?',
  'Do day/night or weather changes impair gameplay readability?',
  'Is there sufficient visual contrast between enemies and the player character?',
  'Do icon designs intuitively convey their functions?',
  'Is the splash screen and main menu first impression impactful?',
  'Is an art asset versioning and review process established?',
  'Are UI and gameplay information distinguishable in colorblind mode?',

  // UI/UX (extended)
  'Where do players experience confusion in the first-time user experience (FTUE)?',
  'Is there an option to skip the tutorial?',
  'Is the click count minimized for frequently-used UI like shops and inventory?',
  'Is the in-game notification system not overly disruptive?',
  'Can returning players quickly understand their previous state?',
  'Do error messages clearly guide the cause and resolution?',
  'Is there sufficient graphics/audio customization in the settings menu?',
  'Are loading screens used in a way that maintains immersion in the game world?',
  'Is controller remapping supported?',
  'Are subtitle/text size adjustment options available?',

  // Sound & Music (extended)
  'Are footsteps and ambient sounds effectively enhancing level atmosphere?',
  'Does music transition naturally during tension build-up sections?',
  'Is sound occlusion (obstacle-based audio dampening) implemented?',
  'Is random pitch modulation applied to looping sounds?',
  'Do UI click sounds match the overall game tone?',
  'Is music ducking applied during dialogue?',
  'Is the game sufficiently readable without music?',
  'Is sound asset license review complete?',
  'Are spatial audio (3D sound) range settings natural?',
  'Is communication between sound engineers and the gameplay team smooth?',

  // Narrative & Story (extended)
  'Does the protagonist\'s motivation generate empathy in the player?',
  'Is environmental storytelling sufficiently utilized?',
  'If choices exist, are the consequences of each choice consistently reflected?',
  'Are side quests thematically connected to the main story?',
  'Is the character growth arc sufficiently conveyed?',
  'Is world lore delivered naturally without being forced?',
  'Is there sufficient foreshadowing for twists or surprise elements?',
  'Is narrative nuance preserved during multilingual localization?',
  'Do lengthy cutscenes overly remove the player\'s sense of control?',
  'Is a story skip option provided for replay players?',

  // Level Design Deep-Dive
  'Is wayfinding within levels designed intuitively?',
  'Does level flow maintain an action → tension relief → exploration rhythm?',
  'Does the first level introduce all core mechanics?',
  'Are reward spaces sufficiently placed after challenge spaces?',
  'Do secret areas or hidden routes stimulate the desire to explore?',
  'Are environmental obstacles used interchangeably for combat and puzzles?',
  'Are there elements that provide a new experience on level revisits?',
  'Is the level scale appropriate relative to the player character size?',
  'Is the ratio of dead ends to open paths appropriate?',
  'Was the level design intent sufficiently validated at the whitebox stage?',
  'Does checkpoint placement maintain the will to learn and retry?',
  'For multiplayer maps, is spawn fairness between teams guaranteed?',

  // System Design & Code Architecture
  'Is data-driven design sufficiently applied?',
  'Are there excessive couplings between game systems?',
  'Is cheat defense and game logic separated into server-authoritative architecture?',
  'Is the save data format backward compatible for future updates?',
  'Is an event system used to reduce coupling between systems?',
  'Is the game state machine design clearly documented?',
  'Are global configuration values managed centrally?',
  'Are editor tools sufficiently exposed for designers to adjust directly?',
  'Is deterministic logic guaranteed for replay or spectator feature implementation?',
  'Is the modular quest/event system structured for scalability?',

  // AI & NPC Design
  'Do NPCs have patterns that are perceivable to the player?',
  'Are boss AI phase transitions conveyed with clear visual signals?',
  'Is enemy AI designed to respond appropriately to player strategies?',
  'Is AI difficulty adjustment done dynamically?',
  'Is there a fallback for NPC pathfinding getting blocked?',
  'Are there situations where ally AI interferes with the player?',
  'Is AI behavior predictable yet varied for the player?',
  'Is crowd AI computation cost within budget?',
  'Can the AI state machine be visually verified in the editor?',
  'Do NPC dialogue AI responses remain contextually consistent?',

  // Economy & Monetization
  'Are hard currency and soft currency roles clearly differentiated?',
  'Is ad insertion frequency not overly disrupting the play experience?',
  'Does DLC or season pass content not separate from the core game experience?',
  'Can free-to-play players enjoy the core content?',
  'Is in-app purchase UX not coercive?',
  'Is the value of subscriptions or battle passes clearly communicated to players?',
  'Does pricing reflect regional purchasing power?',
  'Is the monetization model appropriate for the game genre and target audience?',
  'Are refund policies and payment error response processes established?',
  'Is the live service event cycle designed to avoid player burn-out?',

  // Accessibility & Inclusivity
  'Is there an alternative color mode for colorblind players?',
  'Is there a simplified UI mode that reduces cognitive load?',
  'Is text-to-speech (TTS) or screen reader support available?',
  'Are control layout options available for one-handed players?',
  'Do flashing effects comply with photosensitive seizure standards?',
  'Are there visual feedback alternatives for hearing-impaired players?',
  'Are assistive features like movement speed and aim assist optionally activatable?',
  'Can text language and audio language be configured independently?',
  'Are characters from diverse backgrounds naturally represented in the story?',
  'Has the content been reviewed for cultural stereotypes?',

  // Platform & Porting
  'Has performance profiling been conducted independently per platform?',
  'Is the list of console certification requirements (TRC/TCR/LotCheck) organized?',
  'Is battery drain and heat within acceptable limits for mobile porting?',
  'Does the PC version support ultrawide and multi-monitor resolutions?',
  'Is balance parity maintained across platforms for cross-play support?',
  'Does cloud save synchronization meet platform-specific limitations?',
  'Has minimum spec testing been conducted on Steam Deck or handheld devices?',
  'Are per-platform achievement/trophy systems correctly integrated?',
  'Are age rating requirements per platform store guidelines met?',
  'Is tone mapping optimized for HDR-supported devices?',

  // Project Management (extended)
  'Is the team onboarding documentation kept up to date?',
  'Are technical and design documents synchronized with the code?',
  'Are retrospective results leading to actual process improvements?',
  'Are there team members showing signs of crunch?',
  'Are decision-making authorities clearly defined?',
  'Is the boundary between pre-production and production clearly set?',
  'Is knowledge sharing happening to prepare for key personnel departure?',
  'Is the internal alpha/beta schedule realistically connected to the final launch date?',
  'Is a team restructuring plan in place for the transition to live operations?',
  'Is there a post-mortem writing plan?',

  // Team Culture & Collaboration
  'Is the idea suggestion channel open regardless of seniority?',
  'Does the whole team share the same understanding of the game\'s vision?',
  'Are 1:1 feedback loops between leads and team members happening regularly?',
  'Is there sufficient mutual understanding of different disciplines\' work styles?',
  'Are collaboration tools for remote teams sufficiently equipped?',
  'Is there a process for healthily resolving disagreements within the team?',
  'Is recognition and reward for performance happening fairly?',
  'Is there an onboarding path for new members to contribute quickly?',
  'Is the team\'s burn-out index checked periodically?',
  'Are learning and growth opportunities outside game development provided to team members?',

  // Player & Data (extended)
  'Does cohort analysis show a specific player group\'s churn pattern?',
  'What is the first action players take when starting a session?',
  'Is the FTUE completion rate meeting targets?',
  'Where is there room to improve in-app purchase conversion rates?',
  'What are the key keywords in positive and negative reviews?',
  'Is there user-generated content being created organically in the player community?',
  'What are the play pattern differences between whale users and regular users?',
  'Does the data collection scope comply with the privacy policy?',
  'Has the retention improvement effect during event periods been measured?',
  'What are the most frequently repeated inquiry types in player support (CS) tickets?',

  // Launch & Marketing (extended)
  'Is the target audience strategy differentiated per social media channel?',
  'Is there a plan for collaborating with streamers and content creators?',
  'Does the game trailer convey the core hook within 15 seconds?',
  'Is an early access or beta sign-up page ready?',
  'Is a server load response plan established for launch day?',
  'Is there a media embargo lift schedule and review build distribution plan?',
  'Is influencer NDA management being handled appropriately?',
  'Is the game community (Discord/Reddit) being built in advance?',
  'Is there a plan to attend game exhibitions like GDC or PAX?',
  'Is there a first 48-hour communication plan after launch (hotfix response, announcements)?',
]

const BTN_STYLE: React.CSSProperties = {
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)',
}

export default function QuickQuestions() {
  const sendMessage = useChatStore(s => s.sendMessage)
  const question = useMemo(
    () => QUICK_QUESTIONS[Math.floor(Math.random() * QUICK_QUESTIONS.length)],
    []
  )
  const handleClick = useCallback(() => sendMessage(question), [sendMessage, question])

  return (
    <div className="flex justify-center" data-testid="quick-questions">
      <button
        onClick={handleClick}
        data-testid="quick-q-0"
        className="text-xs px-2.5 py-1 rounded-full transition-colors hover:opacity-80"
        style={BTN_STYLE}
      >
        {question}
      </button>
    </div>
  )
}
