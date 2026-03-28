import { useMemo, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'

const QUICK_QUESTIONS = [
  // Tech & Performance
  'What is the biggest technical bottleneck right now?',
  'Summarize the current performance optimization status.',
  'Are there any areas with frame rate issues?',
  'Is memory usage within the target range?',
  'Are there any issues with the build pipeline?',
  'Which tech debt items need immediate attention?',
  'Are there recurring patterns in crash reports?',
  'Are there any external middleware or SDK integration issues?',
  'How can we reduce loading times?',
  'Where are there opportunities for draw call optimization?',
  'Are there areas with shader compilation hitches?',
  'Are there any anomalies in physics simulation performance?',
  'Is network latency affecting gameplay?',
  'What is causing the editor build time to increase?',
  'Where are the hotspots in profiler results?',

  // QA & Bugs
  'Which unresolved bugs have the highest priority?',
  'What are the key issues recently found in QA?',
  'What types of bugs have the highest reproduction rate?',
  'Which areas lack regression test coverage?',
  'Are there any platform-specific bugs occurring?',
  'Are there systems with inadequate edge case handling?',

  // Gameplay & Design
  'What areas need balance adjustments in gameplay?',
  'What areas need improvement in level design?',
  'How can we improve the player onboarding experience?',
  'Are there balance issues in the in-game economy system?',
  'Are enemy AI behavior patterns working as intended?',
  'Does the difficulty curve feel as intended?',
  'Are there areas where players get stuck?',
  'Is the core game loop engaging enough?',
  'Does the reward system maintain player motivation well?',
  'What is the feedback on controls/feel?',
  'Is there feedback about uncomfortable camera behavior?',
  'Are skill/item synergies well-designed?',
  'Does the tutorial teach core mechanics sufficiently?',
  'Is the game session length appropriate?',

  // Art & Visuals
  'What is the latest feedback on art direction?',
  'What is the current status of character animation quality?',
  'What can be improved in cutscenes or cinematics?',
  'Does the environment art detail level meet targets?',
  'Do VFX effectively convey gameplay feedback?',
  'Does the lighting set the mood well?',
  'Do UI visuals match the overall art style?',
  'Does the color palette look good on platform screens?',

  // UI/UX
  'Is there feedback about confusing UI/UX?',
  'Are accessibility features ready?',
  'Is the HUD information too much or too little?',
  'Is inventory/menu navigation intuitive?',
  'Is font readability acceptable at all resolutions?',
  'Is the controller and keyboard UI experience equivalent?',

  // Sound & Music
  'Is the sound design direction on track?',
  'Are sound effects well-synchronized with actions?',
  'Does the BGM support the game atmosphere well?',
  'Are there issues with audio mixing balance?',
  'What is the progress on voice-over recording?',

  // Narrative & Story
  'Are there narrative consistency issues?',
  'Does the dialogue tone match character personalities?',
  'Does the story pacing engage players well?',
  'Are world-building details conveyed sufficiently?',
  'Will the ending meet player expectations?',

  // Project Management
  'Summarize the priorities for this milestone.',
  'Are there any cross-team alignment issues?',
  'What were the key decisions from recent team meetings?',
  'What tasks are delayed due to resource (time/staff) shortages?',
  'What areas should be the focus for the next sprint?',
  'What is the highest risk development item currently?',
  'Are there features that can be cut from the current scope?',
  'Are there missing items in the pre-launch checklist?',
  'Is the code review process between team members running smoothly?',
  'Is the milestone schedule realistically achievable?',
  'Is communication with outsourcing partners smooth?',
  'What were the blockers this week?',

  // Player & Data
  'What are the recurring complaints in player feedback?',
  'Are there notable anomalies in data analytics metrics?',
  'What factors affect user retention?',
  'Where is the highest player churn point?',
  'What insights came from A/B test results?',
  'What were the common reactions in playtest sessions?',
  'Are there changes in review/rating trends?',

  // Multiplayer & Server
  'Have multiplayer synchronization issues been reported?',
  'What is the server stability and uptime status?',
  'Is the anti-cheat system working effectively?',
  'What is the feedback on matchmaking quality?',
  'Is the server ready to scale during concurrent user spikes?',

  // Launch & Marketing
  'What is the status of store page and marketing materials?',
  'Are we ready for platform certification (TRC/TCR)?',
  'What is the progress on localization work?',
  'Are there any changes to the launch timing strategy?',
  'Are press kits and media response materials ready?',
  'What is the plan for patch notes and community announcements?',

  // Innovation & Improvement
  'What ideas need validation at the prototype stage?',
  'Which current stage has the lowest completion level?',
  'Is the differentiation point against competitors clear?',
  'Are there moments players will remember for a long time?',
  'What is the game\'s strongest hook?',
  'What tasks in the development workflow can be automated?',
  'What is the most impactful change for the next update?',

  // Tech & Performance (Additional)
  'Are there object groups that can utilize GPU instancing?',
  'Are LOD transition distance settings optimized?',
  'Are there scenes where occlusion culling works properly?',
  'Does the asset streaming strategy meet the memory budget?',
  'Are there areas with GC (garbage collection) spikes?',
  'Is thread utilization optimized?',
  'Are texture compression formats set correctly for target platforms?',
  'Are there hitches from runtime shader switching?',
  'Are there unnecessary collision checks in physics layer settings?',
  'Is the particle system max particle budget being respected?',
  'Are animation compression settings optimized?',
  'Is the audio streaming vs preload classification correct?',
  'Is the navigation mesh update cost excessive?',
  'Are there ways to reduce loading spikes during scene transitions?',
  'Where are object pools needed for frequently allocated/deallocated objects?',

  // QA & Bugs (Additional)
  'Are there core flows not covered by automated testing?',
  'Does the same bug reproduce differently across platforms?',
  'Are there state inconsistency bugs during save/load?',
  'Are there layout issues on multi-monitor or non-standard resolutions?',
  'Are debug cheat codes sufficient for bug reproduction?',
  'What issues emerged from stress testing (extended play sessions)?',
  'What is the oldest unresolved issue in the bug tracking system?',
  'Are there required fixes demanded by the publishing partner?',
  'Are there soft bugs that ruin the game experience without crashing?',
  'Are there behavioral differences between test builds and release builds?',

  // Gameplay & Design (Additional)
  'Do death/failure situations feel motivating rather than frustrating?',
  'Do player choices produce meaningful outcomes?',
  'Is the gap between skill ceiling and skill floor appropriate?',
  'Is the feedback for core verbs (jump, attack, dodge) clear?',
  'Are in-game objectives always clearly presented to players?',
  'Are there elements that maintain freshness on repeated play?',
  'Can social play or sharing elements drive virality?',
  'Are save point frequencies appropriately placed without frustration?',
  'Do boss fights follow a learn, master, reward structure?',
  'If open-world, is exploration motivation sufficiently provided?',
  'Does puzzle difficulty escalate logically?',
  'Is a non-violent play style supported?',
  'Are emergent interactions between systems intentionally designed?',
  'Do players have room to express their own playstyle?',
  'Are pacing control sections sufficiently distributed?',
  'Is contribution feeling fair for all players in co-op?',
  'Is the pricing appropriate relative to content volume?',
  'Are there elements that encourage multiple playthroughs?',
  'Are there irreversible elements players could accidentally delete or consume?',
  'Is controller vibration (haptic feedback) being utilized appropriately?',

  // Art & Visuals (Additional)
  'Is the gap between concept art and final in-game visuals too large?',
  'Are character silhouettes distinguishable from a distance?',
  'Do PBR material settings show consistent lighting response?',
  'Are particle effects flashy enough within the performance budget?',
  'Are chromatic aberration, vignetting and other post-process effects too strong?',
  'Is character facial animation expressiveness sufficient?',
  'Is the stylized vs realistic direction shared across the whole team?',
  'Are asset naming conventions and folder structure maintained consistently?',
  'Does environment design naturally convey the game narrative?',
  'Do day/night or weather changes not harm gameplay readability?',
  'Is the visual contrast between enemy and player characters sufficient?',
  'Do icon designs intuitively convey functionality?',
  'Is the splash screen and main menu first impression strong?',
  'Are art asset version control and review processes established?',
  'Are UI and gameplay information distinguishable in colorblind mode?',

  // UI/UX (Additional)
  'Where do players feel confused in the first-time user experience (FTUE)?',
  'Is there an option to skip the tutorial?',
  'Are click counts minimized in frequently used UI like shop/inventory?',
  'Is the in-game notification system not overly intrusive?',
  'Can returning players quickly understand their previous state?',
  'Do error messages clearly indicate causes and solutions?',
  'Is graphics/audio customization sufficient in the settings menu?',
  'Are loading screens used in a way that maintains immersion?',
  'Is controller remapping supported?',
  'Are subtitle/text size adjustment options available?',

  // Sound & Music (Additional)
  'Do footsteps and ambient sounds effectively enhance level atmosphere?',
  'Does music transition naturally during tension buildup sections?',
  'Is sound occlusion (obstacle blocking) implemented?',
  'Is random pitch modulation applied to repeating sounds?',
  'Do UI click sounds match the overall game tone?',
  'Is background music ducking applied during dialogue?',
  'Is the game still readable when playing without music?',
  'Has the sound asset license review been completed?',
  'Are spatial audio (3D sound) range settings natural?',
  'Is communication between sound engineers and gameplay teams smooth?',

  // Narrative & Story (Additional)
  'Does the protagonist\'s motivation evoke empathy from players?',
  'Is environmental storytelling being utilized sufficiently?',
  'If there are choices, are the consequences of each choice reflected consistently?',
  'Do sub-quests connect thematically to the main story?',
  'Is the character growth arc conveyed sufficiently?',
  'Is world lore delivered naturally without being forced?',
  'Are plot twists and surprises sufficiently foreshadowed?',
  'Are narrative nuances preserved during multilingual localization?',
  'Do long cutscenes not excessively take away player agency?',
  'Is a story skip option provided for replayers?',

  // Level Design Deep Dive
  'Is wayfinding within levels intuitively designed?',
  'Does the level flow maintain an action, tension release, exploration rhythm?',
  'Does the first level introduce all core mechanics?',
  'Are reward spaces sufficiently placed after challenge spaces?',
  'Do secret spaces or hidden routes stimulate the desire to explore?',
  'Are environmental obstacles utilized in both combat and puzzles?',
  'Are there elements that provide a new experience when revisiting levels?',
  'Is the level scale appropriate relative to player character size?',
  'Is the ratio of blocked paths to open paths appropriate?',
  'Was the level design intent sufficiently validated at the whitebox stage?',
  'Does checkpoint placement maintain the will to learn and retry?',
  'If it\'s a multiplayer map, is spawn fairness between teams guaranteed?',

  // System Design & Code Architecture
  'Is data-driven design sufficiently applied?',
  'Are dependencies between game systems not overly coupled?',
  'Are cheat defense and game logic separated as server-authoritative?',
  'Is the save data format backward-compatible with future updates?',
  'Is the event system used to reduce coupling between systems?',
  'Is the game state machine design clearly documented?',
  'Are global configuration values centrally managed?',
  'Are editor tools sufficiently exposed for designers to directly adjust?',
  'Is deterministic logic guaranteed for replay or spectator features?',
  'Is the modular quest/event system structured favorably for extension?',

  // AI & NPC Design
  'Does NPC AI have recognizable patterns for players?',
  'Are boss AI phase transitions communicated with clear visual signals?',
  'Is enemy AI designed to respond appropriately to player strategies?',
  'Is AI difficulty adjustment happening dynamically?',
  'Is there a fallback for when NPC movement paths get blocked?',
  'Are there situations where ally AI interferes with the player?',
  'Is AI behavior both predictable and varied for players?',
  'Is crowd AI computational cost within budget?',
  'Is the AI state machine visually verifiable in the editor?',
  'Does NPC dialogue AI maintain consistent responses without losing context?',

  // Economy & Monetization
  'Are the roles of hard and soft currency clearly distinguished?',
  'Does ad insertion frequency not excessively disrupt the play experience?',
  'Does DLC or season pass content not fragment the base game experience?',
  'Can free-to-play players enjoy the core content?',
  'Is the in-game purchase UX not coercive?',
  'Is the value proposition of subscription models or battle passes clearly communicated to players?',
  'Does pricing reflect regional purchasing power?',
  'Is the monetization model suitable for the game genre and target audience?',
  'Are refund policies and payment error response processes in place?',
  'Are live service event cycles designed without player burnout?',

  // Accessibility & Inclusivity
  'Are there alternative color modes for color-vision-deficient players?',
  'Is there a simplified UI mode to reduce cognitive load?',
  'Is text-to-speech (TTS) or screen reader support available?',
  'Are there control layout options for one-handed players?',
  'Do flashing effects comply with photosensitive seizure standards?',
  'Are there visual feedback alternatives for hearing-impaired players?',
  'Can assistive features like movement speed and auto-aim be selectively enabled?',
  'Can text language and voice language be set independently?',
  'Are characters from diverse backgrounds naturally represented in the story?',
  'Has the content been reviewed for expressions that reinforce cultural stereotypes?',

  // Platform & Porting
  'Has performance profiling been conducted independently for each platform?',
  'Has the console certification requirements (TRC/TCR/LotCheck) response list been organized?',
  'Are battery consumption and heat within acceptable ranges for mobile porting?',
  'Does the PC version support ultrawide and multi-monitor resolutions?',
  'Is balance parity maintained across platforms for cross-play?',
  'Does cloud save sync meet platform-specific limitations?',
  'Has minimum spec testing been done on Steam Deck or handheld devices?',
  'Are platform-specific achievement/trophy systems properly integrated?',
  'Do all platform store guidelines\' age rating requirements get met?',
  'Are tone mapping settings optimized on HDR-capable devices?',

  // Project Management (Additional)
  'Is team onboarding documentation kept up to date?',
  'Are technical and design documents synchronized with code?',
  'Are retrospective results leading to actual process improvements?',
  'Are there team members showing signs of crunch?',
  'Are decision-making authorities clearly defined?',
  'Is the pre-production to production boundary clearly set?',
  'Is knowledge sharing happening to prepare for key personnel departures?',
  'Is the internal alpha/beta schedule realistically connected to the final launch date?',
  'Is team restructuring for live operations transition planned?',
  'Is there a plan for post-mortem writing?',

  // Team Culture & Collaboration
  'Are idea submission channels open regardless of rank?',
  'Does the entire team share the same understanding of the game\'s vision?',
  'Are lead-to-member 1:1 feedback loops happening regularly?',
  'Is there sufficient mutual understanding of work methods across different roles?',
  'Are collaboration tools sufficient for remote or distributed teams?',
  'Is there a healthy process for resolving team disagreements?',
  'Is recognition and reward for performance handled fairly?',
  'Is there an onboarding path for new team members to contribute quickly?',
  'Are team burnout indicators being checked regularly?',
  'Are learning and growth opportunities provided to team members beyond game development?',

  // Player & Data (Additional)
  'Are there churn patterns for specific player groups in cohort analysis?',
  'What is the first action players take at the start of a session?',
  'Is the FTUE completion rate reaching targets?',
  'Where are there opportunities to improve in-app purchase conversion rates?',
  'What are the key keywords in positive and negative reviews?',
  'Is there organically created content from the player community?',
  'What are the differences in play patterns between whale users and regular users?',
  'Do data collection items comply with the privacy policy?',
  'Has the retention improvement effect been measured during event periods?',
  'What are the recurring inquiry types in player support (CS) tickets?',

  // Launch & Marketing (Additional)
  'Are target audience strategies differentiated by social media channel?',
  'Are there plans for streamer/content creator collaborations?',
  'Does the game trailer convey the core hook within 15 seconds?',
  'Is the early access or beta sign-up page ready?',
  'Has a server load response plan been established for launch day?',
  'Are media embargo release schedules and review build distribution plans in place?',
  'Is influencer NDA management being handled appropriately?',
  'Are game communities (Discord/Reddit) being built in advance?',
  'Are there plans to attend game expos like GDC/PAX?',
  'Is there a communication plan for the first 48 hours post-launch (hotfix response, announcements)?',
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
