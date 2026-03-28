"""
mirofish_runner.py — OASIS 기반 MiroFish 시뮬레이션 (Python 폴백)

LocalZep + SocialGraph + OASISEnvironment를 사용하여
Electron 없을 때 Python으로 전체 OASIS 파이프라인을 실행합니다.

컴포넌트:
  LocalZepClient  — 에이전트 메모리 (Zep Cloud 로컬 대체)
  SocialGraph     — Barabási-Albert 팔로우 네트워크
  OASISEnvironment — 포스트 저장소 + 추천 엔진 + 행동 결정
"""
from __future__ import annotations

import random
from typing import Callable

from .local_zep import LocalZepClient, ZepMessage
from .social_graph import SocialGraph
from .oasis_env import OASISEnvironment, OASISPost

# ── 기본 페르소나 (자동 생성 불가 시 폴백) ────────────────────────────────────

DEFAULT_PERSONAS = [
    {
        "id": "skeptic",
        "name": "회의론자",
        "stance": "opposing",
        "activity": 0.8,
        "influence": 0.7,
        "system": (
            "당신은 신중한 회의론자입니다. 새로운 아이디어나 제품에 대해 비판적으로 검토하고 "
            "잠재적 위험이나 단점을 지적합니다. 2-3문장으로 간결하게 의견을 표현하세요."
        ),
    },
    {
        "id": "enthusiast",
        "name": "얼리어답터",
        "stance": "supportive",
        "activity": 0.9,
        "influence": 0.6,
        "system": (
            "당신은 열정적인 얼리어답터입니다. 새로운 기술과 트렌드에 빠르게 반응하고 긍정적으로 "
            "평가합니다. 구체적인 사용 시나리오를 언급하며 2-3문장으로 의견을 표현하세요."
        ),
    },
    {
        "id": "pragmatist",
        "name": "실용주의자",
        "stance": "neutral",
        "activity": 0.6,
        "influence": 0.8,
        "system": (
            "당신은 실용적인 평가자입니다. 비용 대비 효과, 실제 적용 가능성을 중심으로 "
            "균형 잡힌 의견을 제시합니다. 2-3문장으로 간결하게 의견을 표현하세요."
        ),
    },
    {
        "id": "influencer",
        "name": "인플루언서",
        "stance": "supportive",
        "activity": 0.7,
        "influence": 0.9,
        "system": (
            "당신은 소셜 미디어 인플루언서입니다. 트렌드에 민감하고 팔로워들의 반응을 의식하며 "
            "감성적이고 공감적인 방식으로 의견을 표현합니다. 2-3문장으로 의견을 표현하세요."
        ),
    },
    {
        "id": "expert",
        "name": "도메인 전문가",
        "stance": "neutral",
        "activity": 0.5,
        "influence": 1.0,
        "system": (
            "당신은 해당 분야의 전문가입니다. 기술적 정확성과 산업 표준을 기준으로 심층적인 "
            "분석을 제공합니다. 전문 용어를 적절히 사용하며 2-3문장으로 의견을 표현하세요."
        ),
    },
]

STANCE_KO = {"supportive": "지지", "opposing": "반대", "neutral": "중립", "observer": "관찰"}


# ── 프롬프트 빌더 ─────────────────────────────────────────────────────────────

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
        f"\n\n[배경 정보 — 아래 문서에 명시된 내용만 언급할 것. 문서에 없는 기능·시스템을 지어내지 말 것]\n{context}"
        if context else ""
    )
    mem_block = f"\n\n[나의 이전 발언]\n{memory_context}" if memory_context else ""

    feed_ctx = "\n".join(
        f"[{p.author_name}/{STANCE_KO.get(p.stance, p.stance)}]"
        f"{'↩️ ' if p.original_post_id else ' '}{p.content}"
        for p in recommended[-8:]
    ) or "(아직 게시물이 없습니다)"

    if action == "repost" and repost_target:
        action_inst = (
            f"다음 게시물을 리포스트하면서 1-2문장으로 짧게 코멘트를 추가하세요:\n"
            f'"{repost_target.content}" — {repost_target.author_name}'
        )
    else:
        action_inst = (
            "위 논의를 바탕으로 당신의 관점에서 2-3문장으로 새 게시물을 작성하세요. "
            "자연스럽게 다른 의견에 반응하거나 새로운 관점을 제시하세요."
        )

    return (
        f"주제: \"{topic}\"{ctx_block}{mem_block}\n\n"
        f"[팔로잉 피드 + 트렌딩]\n{feed_ctx}\n\n"
        f"{action_inst}"
    )


# ── 동적 딜레이 ───────────────────────────────────────────────────────────────

def _calc_call_delay(num_personas: int, num_rounds: int) -> float:
    """
    페르소나 수 × 라운드 수 기반 LLM 호출 간격(초) 계산.
    예상 총 호출이 많을수록 간격을 늘려 rate limit 방지.
    activityLevel 평균 0.65 적용, 목표 최대 40 RPM.
    """
    total = num_personas * num_rounds * 0.65
    if total <= 15:  return 0.2    # 소규모: 200ms
    if total <= 40:  return 0.6    # 중규모: 600ms
    if total <= 100: return 1.2    # 대규모: 1.2초
    return 1.5                     # 초대규모: 1.5초


# ── 시뮬레이션 ────────────────────────────────────────────────────────────────

def run_simulation(
    topic: str,
    num_personas: int,
    num_rounds: int,
    claude,  # ClaudeClient instance
    log_fn: Callable[[str], None] | None = None,
    context: str | None = None,
) -> dict:
    """
    OASIS 기반 MiroFish 시뮬레이션.
    반환: {"feed": [...], "report": "..."}
    """
    import time as _time
    _log = log_fn or (lambda _: None)
    call_delay = _calc_call_delay(num_personas, num_rounds)
    personas = DEFAULT_PERSONAS[: min(num_personas, len(DEFAULT_PERSONAS))]

    # ── OASIS 컴포넌트 초기화 ────────────────────────────────────────────────
    agent_ids = [p["id"] for p in personas]
    zep   = LocalZepClient()
    graph = SocialGraph.generate(agent_ids)
    env   = OASISEnvironment(graph)

    feed_entries: list[dict] = []

    # ── 시뮬레이션 루프 ──────────────────────────────────────────────────────
    for round_num in range(1, num_rounds + 1):
        _log(f"[MiroFish] 라운드 {round_num}/{num_rounds}")

        for persona in personas:
            if random.random() > persona["activity"]:
                continue  # 이번 라운드 패스

            # 행동 결정 (OASIS action_space)
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
                        content=f"[좋아요] {target.author_name}: {target.content[:80]}",
                    )])
                continue

            if action == "follow":
                target_id = decision.get("target_agent_id")
                if target_id:
                    graph.follow(persona["id"], target_id)
                    _log(f"[MiroFish] {persona['name']} → {target_id} 팔로우")
                continue

            # post 또는 repost → LLM 호출
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
                _log(f"[MiroFish] {persona['name']} 오류: {e}")
                continue

            # 환경 업데이트
            original_id = repost_target.id if repost_target else None
            post = env.add_post(
                persona["id"], persona["name"], persona["stance"],
                content, round_num, original_post_id=original_id,
            )
            if action == "repost" and repost_target:
                post.reposts.add(persona["id"])
                repost_target.reposts.add(persona["id"])

            # Zep 메모리 업데이트
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

    # ── 보고서 생성 ──────────────────────────────────────────────────────────
    _log("[MiroFish] 보고서 생성 중...")

    # 참여 지표 집계
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
        f"- {name}: 좋아요 {s['likes']}, 리포스트 {s['reposts']}"
        for name, s in top_engaged
    ) or "(집계 없음)"

    feed_text = "\n".join(
        f"[R{e['round']}] [{e['personaName']}/{STANCE_KO.get(e['stance'], e['stance'])}]"
        f"{'↩️' if e['actionType'] == 'repost' else ''} {e['content']}"
        for e in feed_entries
    )

    report_sys = (
        "당신은 시장 조사 및 여론 분석 전문가입니다. "
        "OASIS 소셜 시뮬레이션 결과를 분석하여 통찰력 있는 마크다운 보고서를 작성합니다."
    )
    report_msg = (
        f"다음 소셜 시뮬레이션 결과를 분석하여 보고서를 작성하세요.\n\n"
        f"주제: \"{topic}\"\n\n"
        f"참여 지표 (상위 10):\n{engagement_text}\n\n"
        f"시뮬레이션 피드:\n{feed_text}\n\n"
        "아래 섹션을 포함하세요:\n"
        "## 시뮬레이션 요약\n"
        "## 주요 합의점\n"
        "## 핵심 반대 의견\n"
        "## 참여 패턴 분석\n"
        "## 소셜 영향력 분석\n"
        "## 결론 및 시사점"
    )

    try:
        report = claude.complete(report_sys, report_msg, max_tokens=1500)
    except Exception as e:
        _log(f"[MiroFish] 보고서 오류: {e}")
        report = f"_(보고서 생성 실패: {e})_"

    # 최종 feed 형식 (좋아요/리포스트 수 포함)
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
