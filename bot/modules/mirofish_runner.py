"""
mirofish_runner.py — OASIS-based MiroFish Simulation (Python fallback)

Uses LocalZep + SocialGraph + OASISEnvironment to run
the full OASIS pipeline in Python when Electron is not available.

Components:
  LocalZepClient  — Agent memory (local Zep Cloud replacement)
  SocialGraph     — Barabási-Albert follow network
  OASISEnvironment — Post store + recommendation engine + action decisions
"""
from __future__ import annotations

import random
from typing import Callable

from .local_zep import LocalZepClient, ZepMessage
from .social_graph import SocialGraph
from .oasis_env import OASISEnvironment, OASISPost

# ── Default Personas (fallback when auto-generation is unavailable) ────────────

DEFAULT_PERSONAS = [
    {
        "id": "skeptic",
        "name": "Skeptic",
        "stance": "opposing",
        "activity": 0.8,
        "influence": 0.7,
        "system": (
            "You are a cautious skeptic. You critically review new ideas and products, "
            "pointing out potential risks and drawbacks. Express your opinion concisely in 2-3 sentences."
        ),
    },
    {
        "id": "enthusiast",
        "name": "Early Adopter",
        "stance": "supportive",
        "activity": 0.9,
        "influence": 0.6,
        "system": (
            "You are an enthusiastic early adopter. You react quickly to new technologies and trends "
            "with positive evaluations. Mention specific use scenarios and express your opinion in 2-3 sentences."
        ),
    },
    {
        "id": "pragmatist",
        "name": "Pragmatist",
        "stance": "neutral",
        "activity": 0.6,
        "influence": 0.8,
        "system": (
            "You are a pragmatic evaluator. You present balanced opinions focused on "
            "cost-effectiveness and practical applicability. Express your opinion concisely in 2-3 sentences."
        ),
    },
    {
        "id": "influencer",
        "name": "Influencer",
        "stance": "supportive",
        "activity": 0.7,
        "influence": 0.9,
        "system": (
            "You are a social media influencer. You are sensitive to trends and conscious of follower reactions, "
            "expressing opinions in an emotional and empathetic manner. Express your opinion in 2-3 sentences."
        ),
    },
    {
        "id": "expert",
        "name": "Domain Expert",
        "stance": "neutral",
        "activity": 0.5,
        "influence": 1.0,
        "system": (
            "You are an expert in the field. You provide in-depth analysis based on "
            "technical accuracy and industry standards. Use appropriate terminology and express your opinion in 2-3 sentences."
        ),
    },
]

STANCE_LABEL = {"supportive": "supportive", "opposing": "opposing", "neutral": "neutral", "observer": "observer"}


# ── Prompt Builder ────────────────────────────────────────────────────────────

def _build_post_prompt(
    persona: dict,
    topic: str,
    memory_context: str,
    recommended: list[OASISPost],
    context: str | None,
    action: str,
    repost_target: OASISPost | None,
) -> str:
    ctx_block = (
        f"\n\n[Background Info — Only mention what is explicitly stated in the documents below. Do not fabricate features or systems not in the documents]\n{context}"
        if context else ""
    )
    mem_block = f"\n\n[My Previous Statements]\n{memory_context}" if memory_context else ""

    feed_ctx = "\n".join(
        f"[{p.author_name}/{STANCE_LABEL.get(p.stance, p.stance)}]"
        f"{'↩️ ' if p.original_post_id else ' '}{p.content}"
        for p in recommended[-8:]
    ) or "(No posts yet)"

    if action == "repost" and repost_target:
        action_inst = (
            f"Repost the following post and add a brief 1-2 sentence comment:\n"
            f'"{repost_target.content}" — {repost_target.author_name}'
        )
    else:
        action_inst = (
            "Based on the discussion above, write a new post of 2-3 sentences from your perspective. "
            "Naturally react to other opinions or present a new viewpoint."
        )

    return (
        f"Topic: \"{topic}\"{ctx_block}{mem_block}\n\n"
        f"[Following Feed + Trending]\n{feed_ctx}\n\n"
        f"{action_inst}"
    )


# ── Dynamic Delay ─────────────────────────────────────────────────────────────

def _calc_call_delay(num_personas: int, num_rounds: int) -> float:
    """
    Calculate LLM call interval (seconds) based on persona count x round count.
    Increases interval as expected total calls grow to prevent rate limiting.
    Applies average activityLevel of 0.65, targeting max 40 RPM.
    """
    total = num_personas * num_rounds * 0.65
    if total <= 15:  return 0.2    # Small: 200ms
    if total <= 40:  return 0.6    # Medium: 600ms
    if total <= 100: return 1.2    # Large: 1.2s
    return 1.5                     # Extra large: 1.5s


# ── Simulation ────────────────────────────────────────────────────────────────

def run_simulation(
    topic: str,
    num_personas: int,
    num_rounds: int,
    claude,  # ClaudeClient instance
    log_fn: Callable[[str], None] | None = None,
    context: str | None = None,
) -> dict:
    """
    OASIS-based MiroFish simulation.
    Returns: {"feed": [...], "report": "..."}
    """
    import time as _time
    _log = log_fn or (lambda _: None)
    call_delay = _calc_call_delay(num_personas, num_rounds)
    personas = DEFAULT_PERSONAS[: min(num_personas, len(DEFAULT_PERSONAS))]

    # ── OASIS component initialization ─────────────────────────────────────────
    agent_ids = [p["id"] for p in personas]
    zep   = LocalZepClient()
    graph = SocialGraph.generate(agent_ids)
    env   = OASISEnvironment(graph)

    feed_entries: list[dict] = []

    # ── Simulation loop ───────────────────────────────────────────────────────
    for round_num in range(1, num_rounds + 1):
        _log(f"[MiroFish] 라운드 {round_num}/{num_rounds}")

        for persona in personas:
            if random.random() > persona["activity"]:
                continue  # Skip this round

            # Action decision (OASIS action_space)
            decision = env.decide_action(persona["id"])
            action = decision["action"]

            if action == "do_nothing":
                continue

            if action == "like":
                target = decision.get("target_post")
                if target:
                    env.like_post(persona["id"], target.id)
                    zep.add(persona["id"], [ZepMessage(
                        role="user",
                        content=f"[Liked] {target.author_name}: {target.content[:80]}",
                    )])
                continue

            if action == "follow":
                target_id = decision.get("target_agent_id")
                if target_id:
                    graph.follow(persona["id"], target_id)
                    _log(f"[MiroFish] {persona['name']} → {target_id} followed")
                continue

            # post or repost → LLM call
            memory = zep.get(persona["id"])
            recommended = env.get_recommended_posts(persona["id"])
            repost_target: OASISPost | None = decision.get("target_post") if action == "repost" else None

            user_msg = _build_post_prompt(
                persona, topic,
                memory.context,
                recommended,
                context,
                action,
                repost_target,
            )

            try:
                content = claude.complete(persona["system"], user_msg, max_tokens=200)
                content = content.strip()
            except Exception as e:
                _log(f"[MiroFish] {persona['name']} error: {e}")
                continue

            # Environment update
            original_id = repost_target.id if repost_target else None
            post = env.add_post(
                persona["id"], persona["name"], persona["stance"],
                content, round_num, original_post_id=original_id,
            )
            if action == "repost" and repost_target:
                post.reposts.add(persona["id"])
                repost_target.reposts.add(persona["id"])

            # Zep memory update
            zep.add(persona["id"], [ZepMessage(role="assistant", content=content)])

            feed_entries.append({
                "round":          round_num,
                "postId":         post.id,
                "personaId":      persona["id"],
                "personaName":    persona["name"],
                "stance":         persona["stance"],
                "actionType":     action,
                "content":        content,
                "originalPostId": original_id,
            })
            _log(f"[MiroFish] [{persona['name']}/{action}] {content[:60]}...")
            _time.sleep(call_delay)

    # ── Report generation ──────────────────────────────────────────────────────
    _log("[MiroFish] Generating report...")

    # Engagement metrics aggregation
    engagement: dict[str, dict] = {}
    for p in env.posts:
        engagement[p.author_name] = {
            "likes":   len(p.likes),
            "reposts": len(p.reposts),
        }
    top_engaged = sorted(
        engagement.items(),
        key=lambda x: x[1]["likes"] + x[1]["reposts"],
        reverse=True,
    )[:10]
    engagement_text = "\n".join(
        f"- {name}: likes {s['likes']}, reposts {s['reposts']}"
        for name, s in top_engaged
    ) or "(no data)"

    feed_text = "\n".join(
        f"[R{e['round']}] [{e['personaName']}/{STANCE_LABEL.get(e['stance'], e['stance'])}]"
        f"{'↩️' if e['actionType'] == 'repost' else ''} {e['content']}"
        for e in feed_entries
    )

    report_sys = (
        "You are a market research and public opinion analysis expert. "
        "You analyze OASIS social simulation results to write insightful markdown reports."
    )
    report_msg = (
        f"Analyze the following social simulation results and write a report.\n\n"
        f"Topic: \"{topic}\"\n\n"
        f"Engagement metrics (top 10):\n{engagement_text}\n\n"
        f"Simulation feed:\n{feed_text}\n\n"
        "Include the following sections:\n"
        "## Simulation Summary\n"
        "## Key Consensus Points\n"
        "## Core Opposing Views\n"
        "## Engagement Pattern Analysis\n"
        "## Social Influence Analysis\n"
        "## Conclusions and Implications"
    )

    try:
        report = claude.complete(report_sys, report_msg, max_tokens=1500)
    except Exception as e:
        _log(f"[MiroFish] Report error: {e}")
        report = f"_(Report generation failed: {e})_"

    # Final feed format (including like/repost counts)
    post_map = {p.id: p for p in env.posts}
    feed_output = [
        {
            **entry,
            "likes":     len(post_map[entry["postId"]].likes)   if entry["postId"] in post_map else 0,
            "reposts":   len(post_map[entry["postId"]].reposts) if entry["postId"] in post_map else 0,
            "timestamp": post_map[entry["postId"]].timestamp    if entry["postId"] in post_map else 0,
        }
        for entry in feed_entries
    ]

    return {"feed": feed_output, "report": report}
