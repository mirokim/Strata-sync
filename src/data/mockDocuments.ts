import type { MockDocument } from '@/types'

/**
 * 20 mock documents representing director feedback for Project ECHO (action RPG).
 * Section IDs double as wiki-link slugs.
 * Distribution: Chief×3, Art×5, Plan×4, Level×4, Tech×4
 */
export const MOCK_DOCUMENTS: MockDocument[] = [
  // ── CHIEF DIRECTOR ────────────────────────────────────────────────────────

  {
    id: 'doc_001',
    filename: 'chief_project_vision.md',
    speaker: 'chief_director',
    date: '2025-03-01',
    tags: ['vision', 'direction', 'alignment'],
    links: ['tone_manner_guide', 'core_mechanics_review', 'level_flow_spec', 'tech_architecture'],
    sections: [
      {
        id: 'chief_project_vision_summary',
        heading: 'Project Vision Summary',
        body: 'The core direction of Project ECHO is "a balance between immersive exploration and combat." The art direction ([[tone_manner_guide]]) and gameplay mechanics ([[core_mechanics_review]]) must deliver a consistent experience. All teams must share this vision, and differences in departmental interpretation must be minimized.',
        wikiLinks: ['tone_manner_guide', 'core_mechanics_review'],
      },
      {
        id: 'chief_project_vision_goals',
        heading: 'Quarterly Goals',
        body: 'Key goals this quarter: achieve 95% completion for levels 1–3 ([[level_flow_spec]]), stabilize client frame rate at 60fps ([[tech_architecture]]). Each team must align their departmental OKRs to these goals.',
        wikiLinks: ['level_flow_spec', 'tech_architecture'],
      },
    ],
    rawContent: `---
speaker: chief_director
date: 2025-03-01
tags: [vision, direction, alignment]
links: [[tone_manner_guide]], [[core_mechanics_review]], [[level_flow_spec]], [[tech_architecture]]
---
## Project Vision Summary
The core direction of Project ECHO is "a balance between immersive exploration and combat."

## Quarterly Goals
Key goals this quarter: achieve 95% completion for levels 1–3.`,
  },

  {
    id: 'doc_002',
    filename: 'chief_q1_retrospective.md',
    speaker: 'chief_director',
    date: '2025-03-28',
    tags: ['retrospective', 'q1', 'issues', 'alignment'],
    links: ['character_color_issues', 'progression_balance_issues', 'dungeon01_issues', 'client_optimization_tasks'],
    sections: [
      {
        id: 'chief_q1_retrospective_findings',
        heading: 'Q1 Retrospective Findings',
        body: 'Three major issues from Q1: (1) lack of character color consistency ([[character_color_issues]]), (2) variance in progression system balance ([[progression_balance_issues]]), (3) failure to align goals across teams. The direction gap between the art team and planning team is the most serious issue.',
        wikiLinks: ['character_color_issues', 'progression_balance_issues'],
      },
      {
        id: 'chief_q1_action_items',
        heading: 'Q1 Action Items',
        body: 'Immediate actions: review Dungeon 1 flow ([[dungeon01_issues]]), begin client optimization ([[client_optimization_tasks]]). Each team lead must report progress before the next director meeting.',
        wikiLinks: ['dungeon01_issues', 'client_optimization_tasks'],
      },
    ],
    rawContent: `---
speaker: chief_director
date: 2025-03-28
tags: [retrospective, q1, issues, alignment]
---
## Q1 Retrospective Findings
Three major issues from Q1.

## Q1 Action Items
List of immediate actions.`,
  },

  {
    id: 'doc_003',
    filename: 'chief_milestone_review.md',
    speaker: 'chief_director',
    date: '2025-04-10',
    tags: ['milestone', 'review', 'priority'],
    links: ['feature_priority_list', 'ux_flow_guide', 'area_layout_revisions', 'rendering_spec'],
    sections: [
      {
        id: 'chief_milestone_review_status',
        heading: 'Milestone Review Status',
        body: 'Milestone M3 completion rate: 78%. Feature priority re-adjustment needed ([[feature_priority_list]]). UX flow improvements ([[ux_flow_guide]]) must be reflected in M4. The biggest current risk is schedule delay.',
        wikiLinks: ['feature_priority_list', 'ux_flow_guide'],
      },
      {
        id: 'chief_milestone_next_steps',
        heading: 'Next Steps',
        body: 'Next steps: final approval of area layout ([[area_layout_revisions]]), stabilize rendering pipeline ([[rendering_spec]]). Verification build scheduled for deployment within 2 weeks.',
        wikiLinks: ['area_layout_revisions', 'rendering_spec'],
      },
    ],
    rawContent: `---
speaker: chief_director
date: 2025-04-10
tags: [milestone, review, priority]
---
## Milestone Review Status
Milestone M3 completion rate: 78%.

## Next Steps
Next steps and action items.`,
  },

  // ── ART DIRECTOR ──────────────────────────────────────────────────────────

  {
    id: 'doc_004',
    filename: 'art_character_color_review.md',
    speaker: 'art_director',
    date: '2025-03-15',
    tags: ['character', 'color', 'tone_manner'],
    links: ['tone_manner_guide', 'core_mechanics_review', 'visual_identity_guide'],
    sections: [
      {
        id: 'tone_manner_guide',
        heading: 'Tone & Manner Guide',
        body: 'Project ECHO tone & manner: dark and mysterious world, desaturated dominant colors (ink black + teal), accent colors in deep purple range. High saturation is permitted only for combat effects. The emotional tone of the core loop ([[core_mechanics_review]]) and the visual tone must be consistent.',
        wikiLinks: ['core_mechanics_review'],
      },
      {
        id: 'character_color_issues',
        heading: 'Character Color Issues',
        body: "The protagonist's costume colors do not match the T&M guide. The current version is too saturated and warm-toned. Immediate correction required. In particular, the gold color scheme of skin #3 conflicts with the world-building.",
        wikiLinks: [],
      },
      {
        id: 'character_design_actionitems',
        heading: 'Action Items',
        body: '(1) Reduce saturation of all character costumes by 30%, (2) replace warm tones with neutral/cool tones, (3) review revised designs against [[visual_identity_guide]] standards before re-approval. Assigned to: Kim Chul-su, Deadline: March 22.',
        wikiLinks: ['visual_identity_guide'],
      },
    ],
    rawContent: `---
speaker: art_director
date: 2025-03-15
tags: [character, color, tone_manner]
---
## Tone & Manner Guide
Project ECHO tone & manner guide.

## Character Color Issues
Protagonist costume color mismatch.

## Action Items
Correction instructions and assignees.`,
  },

  {
    id: 'doc_005',
    filename: 'art_environment_tonality.md',
    speaker: 'art_director',
    date: '2025-03-20',
    tags: ['environment', 'art', 'lighting', 'atmosphere'],
    links: ['environmental_art_spec', 'level_flow_spec', 'sight_guidance_rules'],
    sections: [
      {
        id: 'environmental_art_spec',
        heading: 'Environmental Art Spec',
        body: 'Environmental art standards: dungeon interiors use dark blue-based lighting with natural light blocked. Visual guidance is placed along the paths players travel in the level flow ([[level_flow_spec]]). Object density is capped at 150 per zone.',
        wikiLinks: ['level_flow_spec'],
      },
      {
        id: 'environmental_art_issues',
        heading: 'Current Issues',
        body: 'Zone 1 lighting is too bright, harming atmosphere. Objects placed at sight-guidance points ([[sight_guidance_rules]]) are actually blocking the player\'s view. Requesting a 40% reduction in lighting intensity.',
        wikiLinks: ['sight_guidance_rules'],
      },
    ],
    rawContent: `---
speaker: art_director
date: 2025-03-20
tags: [environment, art, lighting, atmosphere]
---
## Environmental Art Spec
Environmental art specification.

## Current Issues
Issues currently identified.`,
  },

  {
    id: 'doc_006',
    filename: 'art_ui_visual_identity.md',
    speaker: 'art_director',
    date: '2025-03-25',
    tags: ['ui', 'visual_identity', 'hud', 'consistency'],
    links: ['visual_identity_guide', 'ux_flow_guide'],
    sections: [
      {
        id: 'visual_identity_guide',
        heading: 'Visual Identity Guide',
        body: 'UI visual identity: standardize to a single Gothic typeface, apply line-icon style consistently for all icons, and follow the speaker color palette. The visual hierarchy must align with the UX flow ([[ux_flow_guide]]).',
        wikiLinks: ['ux_flow_guide'],
      },
      {
        id: 'ui_consistency_issues',
        heading: 'UI Consistency Issues',
        body: 'Font sizes and spacing differ across inventory, skill window, and map UI. Three different icon styles are also mixed in the HUD. A unified style guide needs to be created and distributed to the entire UI team.',
        wikiLinks: [],
      },
    ],
    rawContent: `---
speaker: art_director
date: 2025-03-25
tags: [ui, visual_identity, hud, consistency]
---
## Visual Identity Guide
UI visual identity guide.

## UI Consistency Issues
Current UI consistency issues.`,
  },

  {
    id: 'doc_007',
    filename: 'art_cinematic_guidelines.md',
    speaker: 'art_director',
    date: '2025-04-01',
    tags: ['cinematic', 'cutscene', 'camera', 'storytelling'],
    links: ['cinematic_style_guide', 'core_mechanics_review'],
    sections: [
      {
        id: 'cinematic_style_guide',
        heading: 'Cinematic Style Guide',
        body: 'Cutscene art direction: depth-of-field effect required on close-ups, camera movement must follow cinematic convention. Pre-combat cutscenes should have additional desaturation for tension. Highlight key moments of the core mechanic ([[core_mechanics_review]]) with cutscenes.',
        wikiLinks: ['core_mechanics_review'],
      },
      {
        id: 'cinematic_action_items',
        heading: 'Cinematic Action Items',
        body: '(1) Rework opening cutscene camera movement, (2) apply depth-of-field to boss entrance sequence, (3) review color grading of ending sequence. Assigned to: Video team, Deadline: April 15.',
        wikiLinks: [],
      },
    ],
    rawContent: `---
speaker: art_director
date: 2025-04-01
tags: [cinematic, cutscene, camera]
---
## Cinematic Style Guide
Cutscene art direction guide.

## Cinematic Action Items
Cutscene revision instructions.`,
  },

  {
    id: 'doc_008',
    filename: 'art_concept_feedback_202503.md',
    speaker: 'art_director',
    date: '2025-03-18',
    tags: ['concept', 'feedback', 'character', 'iteration'],
    links: ['tone_manner_guide', 'concept_revision_requirements'],
    sections: [
      {
        id: 'concept_feedback_202503',
        heading: 'Concept Art Feedback — March 2025',
        body: 'March concept art review feedback: boss character silhouette approved, colors rejected. Exceeds the world saturation specified in the T&M guide ([[tone_manner_guide]]). 2 of 3 background concepts require rework.',
        wikiLinks: ['tone_manner_guide'],
      },
      {
        id: 'concept_revision_requirements',
        heading: 'Revision Requirements',
        body: 'Rework items: submit 3 color scheme options for the boss, reinterpret atmosphere for backgrounds B-02 and B-03. Next concept review scheduled for the April 1st morning meeting. Revisions must include a comparison slide with previous reference work.',
        wikiLinks: [],
      },
    ],
    rawContent: `---
speaker: art_director
date: 2025-03-18
tags: [concept, feedback, iteration]
---
## Concept Art Feedback — March 2025
March concept art review feedback.

## Revision Requirements
Rework requirements.`,
  },

  // ── PLAN DIRECTOR ─────────────────────────────────────────────────────────

  {
    id: 'doc_009',
    filename: 'plan_core_mechanics_review.md',
    speaker: 'plan_director',
    date: '2025-03-10',
    tags: ['mechanics', 'core_loop', 'gameplay', 'feedback'],
    links: ['core_mechanics_review', 'ux_flow_guide', 'progression_spec'],
    sections: [
      {
        id: 'core_mechanics_review',
        heading: 'Core Mechanics Review',
        body: 'Core loop structure: Explore → Combat → Reward → Enhance → Explore. Currently, low post-combat reward awareness is reducing motivation to upgrade. The UX flow ([[ux_flow_guide]]) needs to express reward presentation more clearly. Average session time: currently 18 minutes, target 25 minutes.',
        wikiLinks: ['ux_flow_guide'],
      },
      {
        id: 'core_mechanics_action',
        heading: 'Action Items',
        body: '(1) Strengthen reward acquisition effects, (2) simplify upgrade system entry UI, (3) re-balance rewards after reviewing the progression spec ([[progression_spec]]). Corrections based on playtest results within 2 weeks.',
        wikiLinks: ['progression_spec'],
      },
    ],
    rawContent: `---
speaker: plan_director
date: 2025-03-10
tags: [mechanics, core_loop, gameplay]
---
## Core Mechanics Review
Core loop analysis and feedback.

## Action Items
Immediate action items.`,
  },

  {
    id: 'doc_010',
    filename: 'plan_progression_system.md',
    speaker: 'plan_director',
    date: '2025-03-17',
    tags: ['progression', 'balance', 'level_design', 'rpg'],
    links: ['progression_spec', 'core_mechanics_review', 'feature_priority_list'],
    sections: [
      {
        id: 'progression_spec',
        heading: 'Progression System Spec',
        body: 'Progression system specs: XP curve is linear for levels 1–10, exponential increase for levels 11–30. Skill tree has 3 branches. Must integrate with the core mechanic ([[core_mechanics_review]]) so that upgrades are immediately reflected in combat.',
        wikiLinks: ['core_mechanics_review'],
      },
      {
        id: 'progression_balance_issues',
        heading: 'Balance Issues',
        body: 'Difficulty spike detected in the level 5–8 range. Balance patch elevated to urgent in the feature priority list ([[feature_priority_list]]). Skill tree branch 2 selection rate is below 5%, effectively making it a dead option.',
        wikiLinks: ['feature_priority_list'],
      },
    ],
    rawContent: `---
speaker: plan_director
date: 2025-03-17
tags: [progression, balance, level_design]
---
## Progression System Spec
Detailed progression system specification.

## Balance Issues
List of balance issues.`,
  },

  {
    id: 'doc_011',
    filename: 'plan_feature_priority_q2.md',
    speaker: 'plan_director',
    date: '2025-04-05',
    tags: ['feature', 'priority', 'q2', 'scope'],
    links: ['feature_priority_list', 'tech_architecture', 'performance_budget'],
    sections: [
      {
        id: 'feature_priority_list',
        heading: 'Feature Priority List Q2',
        body: 'Q2 feature priorities (Must/Should/Could): Must: balance patch, Dungeon 3 completion, server stability. Should: guild system, PvP foundation. Could: appearance customization. Guild system deferred to Q3 due to tech architecture ([[tech_architecture]]) constraints.',
        wikiLinks: ['tech_architecture'],
      },
      {
        id: 'feature_cut_decisions',
        heading: 'Feature Cut Decisions',
        body: 'Features cut from Q2: PvP leaderboard (exceeds performance budget ([[performance_budget]])), summon system (design incomplete). Cut decisions are agreed upon at the team lead level and scheduled for Q4 review.',
        wikiLinks: ['performance_budget'],
      },
    ],
    rawContent: `---
speaker: plan_director
date: 2025-04-05
tags: [feature, priority, q2, scope]
---
## Feature Priority List Q2
Q2 feature priority list.

## Feature Cut Decisions
Feature cut decision records.`,
  },

  {
    id: 'doc_012',
    filename: 'plan_ux_flow_review.md',
    speaker: 'plan_director',
    date: '2025-04-08',
    tags: ['ux', 'flow', 'onboarding', 'ui'],
    links: ['ux_flow_guide', 'visual_identity_guide'],
    sections: [
      {
        id: 'ux_flow_guide',
        heading: 'UX Flow Guide',
        body: 'Core UX principles: new user onboarding within 3 steps, core feature access within 2 taps maximum. Visual identity ([[visual_identity_guide]]) and UX hierarchy must match to achieve intuitive usability.',
        wikiLinks: ['visual_identity_guide'],
      },
      {
        id: 'ux_issues_q2',
        heading: 'UX Issues Q2',
        body: 'UX issues found: (1) inventory access path requires 4 taps — too many, (2) destination marker unclear after accepting a quest, (3) settings menu structure is unintuitive. Begin fixing the top 2 items based on playtest feedback.',
        wikiLinks: [],
      },
    ],
    rawContent: `---
speaker: plan_director
date: 2025-04-08
tags: [ux, flow, onboarding, ui]
---
## UX Flow Guide
Core UX principles and guide.

## UX Issues Q2
Q2 UX issue list.`,
  },

  // ── LEVEL DIRECTOR ────────────────────────────────────────────────────────

  {
    id: 'doc_013',
    filename: 'level_dungeon_01_review.md',
    speaker: 'level_director',
    date: '2025-03-12',
    tags: ['dungeon', 'level', 'flow', 'review'],
    links: ['level_flow_spec', 'sight_guidance_rules', 'environmental_art_spec', 'gimmick_framework'],
    sections: [
      {
        id: 'level_flow_spec',
        heading: 'Level Flow Spec',
        body: 'Level flow baseline: maximum 90 seconds travel time between zones, 3–5 combat encounters per zone, mid-zone checkpoints mandatory. Sight guidance ([[sight_guidance_rules]]) should naturally direct players toward the objective.',
        wikiLinks: ['sight_guidance_rules'],
      },
      {
        id: 'dungeon01_issues',
        heading: 'Dungeon 01 Issues',
        body: 'Dungeon 1 issues: 42% of players get lost in Zone B. Visual guidance is insufficient in the environmental art ([[environmental_art_spec]]). Gimmicks defined in the gimmick framework ([[gimmick_framework]]) are placed without any tutorial.',
        wikiLinks: ['environmental_art_spec', 'gimmick_framework'],
      },
    ],
    rawContent: `---
speaker: level_director
date: 2025-03-12
tags: [dungeon, level, flow, review]
---
## Level Flow Spec
Level flow baseline specification.

## Dungeon 01 Issues
Dungeon 1 issues found.`,
  },

  {
    id: 'doc_014',
    filename: 'level_sight_guidance_spec.md',
    speaker: 'level_director',
    date: '2025-03-19',
    tags: ['sight', 'guidance', 'visual_cue', 'navigation'],
    links: ['sight_guidance_rules', 'level_flow_spec', 'area_layout_guide'],
    sections: [
      {
        id: 'sight_guidance_rules',
        heading: 'Sight Guidance Rules',
        body: 'Sight guidance principles: (1) target locations are always marked with a bright light source, (2) travel paths are hinted at through floor texture changes, (3) no particle effects on dead-end paths. Review together with level flow ([[level_flow_spec]]) to predict player movement patterns.',
        wikiLinks: ['level_flow_spec'],
      },
      {
        id: 'sight_guidance_examples',
        heading: 'Implementation Examples',
        body: 'Application examples in the area layout ([[area_layout_guide]]): place a window light source at the end of corridors to guide forward movement; increase ceiling height on the main path at forks. This pattern is mandated for all new levels.',
        wikiLinks: ['area_layout_guide'],
      },
    ],
    rawContent: `---
speaker: level_director
date: 2025-03-19
tags: [sight, guidance, visual_cue, navigation]
---
## Sight Guidance Rules
Sight guidance principles.

## Implementation Examples
Application examples.`,
  },

  {
    id: 'doc_015',
    filename: 'level_area_layout_feedback.md',
    speaker: 'level_director',
    date: '2025-03-26',
    tags: ['layout', 'area', 'space', 'feedback'],
    links: ['area_layout_guide', 'level_flow_spec', 'dungeon01_issues'],
    sections: [
      {
        id: 'area_layout_guide',
        heading: 'Area Layout Guide',
        body: 'Area layout standards: combat zones minimum 15m×15m, exploration zones maximum 60m×60m. Dead-end space ratio must be 20% or less of the total. Confirm the movement lines defined in the level flow ([[level_flow_spec]]) before designing the layout.',
        wikiLinks: ['level_flow_spec'],
      },
      {
        id: 'area_layout_revisions',
        heading: 'Layout Revisions Required',
        body: 'Zones requiring revision: A-2 (combat space too narrow), B-4 (dead-end ratio exceeds 35%). Full redesign of Zone B linked to Dungeon 1 issues ([[dungeon01_issues]]). Submit revised design within 2 weeks.',
        wikiLinks: ['dungeon01_issues'],
      },
    ],
    rawContent: `---
speaker: level_director
date: 2025-03-26
tags: [layout, area, space, feedback]
---
## Area Layout Guide
Area layout standards.

## Layout Revisions Required
List of zones requiring revision.`,
  },

  {
    id: 'doc_016',
    filename: 'level_gimmick_design_doc.md',
    speaker: 'level_director',
    date: '2025-04-03',
    tags: ['gimmick', 'puzzle', 'interaction', 'mechanics'],
    links: ['gimmick_framework', 'core_mechanics_review'],
    sections: [
      {
        id: 'gimmick_framework',
        heading: 'Gimmick Design Framework',
        body: 'Gimmick design framework: gimmick complexity classified as Level 1–3. Level 1: simple press-to-open activation, Level 2: sequence puzzle, Level 3: multi-object chaining. Prioritize gimmicks that utilize the core mechanic ([[core_mechanics_review]]).',
        wikiLinks: ['core_mechanics_review'],
      },
      {
        id: 'gimmick_priority_list',
        heading: 'Gimmick Priority List',
        body: 'Priority gimmicks to implement: pressure-plate-linked door (Level 1), flame puzzle (Level 2), timed pillars (Level 2). Target implementation within Q2. Level 3 gimmicks planned for Dungeon 4 onward.',
        wikiLinks: [],
      },
    ],
    rawContent: `---
speaker: level_director
date: 2025-04-03
tags: [gimmick, puzzle, interaction]
---
## Gimmick Design Framework
Gimmick design framework.

## Gimmick Priority List
Priority gimmick list.`,
  },

  // ── PROG DIRECTOR ─────────────────────────────────────────────────────────

  {
    id: 'doc_017',
    filename: 'prog_client_optimization.md',
    speaker: 'prog_director',
    date: '2025-03-13',
    tags: ['performance', 'optimization', 'client', 'fps'],
    links: ['performance_budget', 'tech_architecture', 'rendering_spec'],
    sections: [
      {
        id: 'performance_budget',
        heading: 'Performance Budget',
        body: 'Performance budget (target: 60fps @ 1080p): CPU frame time ≤12ms, GPU ≤8ms, memory ≤2GB. Must comply with the system structure defined in the tech architecture ([[tech_architecture]]). Current average GPU time: 14ms (over budget).',
        wikiLinks: ['tech_architecture'],
      },
      {
        id: 'client_optimization_tasks',
        heading: 'Optimization Tasks',
        body: 'Immediate actions: clean up draw calls per rendering spec ([[rendering_spec]]), re-tune the LOD system, improve texture streaming. Profiling results report mandatory within 2 weeks.',
        wikiLinks: ['rendering_spec'],
      },
    ],
    rawContent: `---
speaker: prog_director
date: 2025-03-13
tags: [performance, optimization, client]
---
## Performance Budget
Performance budget standards.

## Optimization Tasks
Optimization task list.`,
  },

  {
    id: 'doc_018',
    filename: 'prog_tech_structure_review.md',
    speaker: 'prog_director',
    date: '2025-03-21',
    tags: ['architecture', 'tech', 'structure', 'design'],
    links: ['tech_architecture', 'performance_budget', 'server_spec'],
    sections: [
      {
        id: 'tech_architecture',
        heading: 'Tech Architecture Overview',
        body: 'System architecture: ECS (Entity Component System) based client, hybrid REST+WebSocket server communication. Performance budget ([[performance_budget]]) is guaranteed at the architecture level. Minimize inter-module dependencies.',
        wikiLinks: ['performance_budget'],
      },
      {
        id: 'tech_debt_items',
        heading: 'Tech Debt Items',
        body: 'Tech debt list (target resolution Q2): replace legacy event system, fix 8 API interfaces that do not meet server spec ([[server_spec]]) standards, patch 3 memory leaks. Priority: High.',
        wikiLinks: ['server_spec'],
      },
    ],
    rawContent: `---
speaker: prog_director
date: 2025-03-21
tags: [architecture, tech, structure]
---
## Tech Architecture Overview
System architecture overview.

## Tech Debt Items
Tech debt list.`,
  },

  {
    id: 'doc_019',
    filename: 'prog_rendering_pipeline.md',
    speaker: 'prog_director',
    date: '2025-03-29',
    tags: ['rendering', 'pipeline', 'graphics', 'optimization'],
    links: ['rendering_spec', 'tech_architecture'],
    sections: [
      {
        id: 'rendering_spec',
        heading: 'Rendering Pipeline Spec',
        body: 'Rendering pipeline: Deferred Rendering + Forward Pass hybrid. Shadows: 4-cascade Cascaded Shadow Map. Post-processing: TAA + SSAO + Bloom. Render components are processed independently, integrated with the ECS in the tech architecture ([[tech_architecture]]).',
        wikiLinks: ['tech_architecture'],
      },
      {
        id: 'rendering_optimization_tasks',
        heading: 'Rendering Optimization Tasks',
        body: 'Optimization priorities: (1) downscale shadow map resolution from 2048 to 1024, (2) apply GPU instancing to particle effects, (3) re-adjust LOD transition distances. After optimization, conduct quality review with the art team (per [[tone_manner_guide]] standards).',
        wikiLinks: ['tone_manner_guide'],
      },
    ],
    rawContent: `---
speaker: prog_director
date: 2025-03-29
tags: [rendering, pipeline, graphics]
---
## Rendering Pipeline Spec
Detailed rendering pipeline specification.

## Rendering Optimization Tasks
Rendering optimization task list.`,
  },

  {
    id: 'doc_020',
    filename: 'prog_server_spec.md',
    speaker: 'prog_director',
    date: '2025-04-07',
    tags: ['server', 'backend', 'network', 'spec'],
    links: ['server_spec', 'tech_architecture', 'client_optimization_tasks'],
    sections: [
      {
        id: 'server_spec',
        heading: 'Server Specification',
        body: 'Server specs: game server Node.js (WebSocket), matchmaking server Go, DB PostgreSQL + Redis caching. API design must align with the REST+WebSocket hybrid approach in the tech architecture ([[tech_architecture]]). Target: 10,000 concurrent users.',
        wikiLinks: ['tech_architecture'],
      },
      {
        id: 'server_integration_tasks',
        heading: 'Server Integration Tasks',
        body: 'Integration tasks: optimize packet size in coordination with client optimization ([[client_optimization_tasks]]), achieve server-client sync latency below 100ms. Stress testing mandatory within Q2.',
        wikiLinks: ['client_optimization_tasks'],
      },
    ],
    rawContent: `---
speaker: prog_director
date: 2025-04-07
tags: [server, backend, network]
---
## Server Specification
Detailed server specification.

## Server Integration Tasks
Server integration task list.`,
  },
]
