"""
oasis_env.py — OASIS 환경 (포스트 저장소 + 추천 엔진)

OASIS environment.py + recommendation_system.py를 Python으로 재현합니다.
포스트 관리, 좋아요/리포스트 추적, 팔로잉 기반 추천을 담당합니다.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

from .social_graph import SocialGraph


@dataclass
class OASISPost:
    id: str
    author_id: str
    author_name: str
    stance: str
    content: str
    round: int
    timestamp: float = field(default_factory=time.time)
    likes: set[str] = field(default_factory=set)     # 좋아요 누른 에이전트 ID
    reposts: set[str] = field(default_factory=set)   # 리포스트한 에이전트 ID
    original_post_id: str | None = None              # 리포스트인 경우 원본 ID


# 행동 타입별 기본 가중치 (OASIS action_space 대응)
_ACTION_WEIGHTS = {
    "post":       0.55,
    "repost":     0.20,
    "like":       0.15,
    "follow":     0.05,
    "do_nothing": 0.05,
}


class OASISEnvironment:
    """
    OASIS 시뮬레이션 환경.
    - 포스트 저장 및 참여(좋아요/리포스트) 추적
    - 팔로잉 기반 + 트렌딩 혼합 추천 (OASIS recommendation_system 대응)
    - 에이전트 행동 결정 (확률 기반, OASIS action_space 대응)
    """

    def __init__(self, graph: SocialGraph) -> None:
        self.posts: list[OASISPost] = []
        self._graph = graph
        self._counter = 0

    # ── 포스트 관리 ───────────────────────────────────────────────────────────

    def add_post(
        self,
        author_id: str,
        author_name: str,
        stance: str,
        content: str,
        round_num: int,
        original_post_id: str | None = None,
    ) -> OASISPost:
        self._counter += 1
        post = OASISPost(
            id=f"post_{self._counter}",
            author_id=author_id,
            author_name=author_name,
            stance=stance,
            content=content,
            round=round_num,
            original_post_id=original_post_id,
        )
        self.posts.append(post)
        return post

    def like_post(self, agent_id: str, post_id: str) -> None:
        for post in self.posts:
            if post.id == post_id:
                post.likes.add(agent_id)
                return

    # ── 추천 엔진 ─────────────────────────────────────────────────────────────

    def get_recommended_posts(self, agent_id: str, limit: int = 15) -> list[OASISPost]:
        """
        OASIS recommendation_system.py 대응.
        1. 팔로잉 에이전트 포스트 (최근 20개)
        2. 전체 트렌딩 (좋아요+리포스트 합산 상위 10개)
        중복 제거 후 limit 반환.
        """
        following = set(self._graph.get_following(agent_id))
        from_following = [
            p for p in self.posts
            if p.author_id in following and p.author_id != agent_id
        ][-20:]

        trending = sorted(
            self.posts,
            key=lambda p: len(p.likes) + len(p.reposts),
            reverse=True,
        )[:10]

        seen: set[str] = set()
        merged: list[OASISPost] = []
        for post in from_following + trending:
            if post.id not in seen:
                seen.add(post.id)
                merged.append(post)

        return merged[:limit]

    # ── 행동 결정 (OASIS action_space 대응) ──────────────────────────────────

    def decide_action(self, agent_id: str) -> dict:
        """
        에이전트의 이번 턴 행동을 확률적으로 결정.
        반환: {"action": str, "target_post"?: OASISPost, "target_agent_id"?: str}
        """
        has_posts = len(self.posts) > 0
        following = self._graph.get_following(agent_id)
        all_ids = self._graph.all_agent_ids()
        not_following = [
            aid for aid in all_ids
            if aid != agent_id and aid not in following
        ]

        weights = dict(_ACTION_WEIGHTS)
        if not has_posts:
            weights["post"] += weights.pop("repost", 0) + weights.pop("like", 0)
        if not not_following:
            weights["post"] += weights.pop("follow", 0)

        actions = list(weights.keys())
        probs = [weights[a] for a in actions]
        total = sum(probs)
        probs = [p / total for p in probs]

        action = random.choices(actions, weights=probs, k=1)[0]
        result: dict = {"action": action}

        if action in ("repost", "like") and has_posts:
            # 트렌딩 상위 5개 중 랜덤 선택
            pool = sorted(
                self.posts,
                key=lambda p: len(p.likes) + len(p.reposts),
                reverse=True,
            )[:5] or self.posts
            result["target_post"] = random.choice(pool)

        elif action == "follow" and not_following:
            result["target_agent_id"] = random.choice(not_following)

        return result
