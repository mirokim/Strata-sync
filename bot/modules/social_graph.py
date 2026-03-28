"""
social_graph.py — OASIS 소셜 네트워크 그래프

Barabási-Albert 선호적 연결 모델로 현실적인 팔로우 네트워크를 생성합니다.
OASIS social_graph.py를 Python으로 재현합니다.
"""
from __future__ import annotations

import random


class SocialGraph:
    def __init__(self, agent_ids: list[str]) -> None:
        self._following: dict[str, set[str]] = {a: set() for a in agent_ids}
        self._followers: dict[str, set[str]] = {a: set() for a in agent_ids}

    @classmethod
    def generate(cls, agent_ids: list[str], m: int = 2) -> "SocialGraph":
        """
        Barabási-Albert 모델로 소셜 그래프 생성.
        m: 신규 노드가 연결할 기존 노드 수 (기본 2).
        팔로워가 많은 노드일수록 새 팔로우를 받을 확률이 높음.
        """
        graph = cls(agent_ids)
        if len(agent_ids) < 2:
            return graph

        # 초기 클리크 (첫 m+1개 노드가 서로 팔로우)
        initial = agent_ids[: min(m + 1, len(agent_ids))]
        for a in initial:
            for b in initial:
                if a != b:
                    graph.follow(a, b)

        # 나머지 노드 순차 추가 — 선호적 연결
        for new_node in agent_ids[len(initial) :]:
            for target in graph._preferential_attachment(new_node, m):
                graph.follow(new_node, target)

        return graph

    def _preferential_attachment(self, exclude: str, m: int) -> list[str]:
        """팔로워 수 비례 가중치로 m개 연결 대상 선택."""
        pool: list[str] = []
        for agent_id, follower_set in self._followers.items():
            if agent_id == exclude:
                continue
            pool.extend([agent_id] * (len(follower_set) + 1))
        random.shuffle(pool)
        targets: set[str] = set()
        for candidate in pool:
            if len(targets) >= m:
                break
            targets.add(candidate)
        return list(targets)

    # ── 팔로우 조작 ───────────────────────────────────────────────────────────

    def follow(self, from_id: str, to_id: str) -> None:
        self._following.setdefault(from_id, set()).add(to_id)
        self._followers.setdefault(to_id, set()).add(from_id)

    def unfollow(self, from_id: str, to_id: str) -> None:
        self._following.get(from_id, set()).discard(to_id)
        self._followers.get(to_id, set()).discard(from_id)

    # ── 조회 ──────────────────────────────────────────────────────────────────

    def get_following(self, agent_id: str) -> list[str]:
        return list(self._following.get(agent_id, set()))

    def get_followers(self, agent_id: str) -> list[str]:
        return list(self._followers.get(agent_id, set()))

    def follower_count(self, agent_id: str) -> int:
        return len(self._followers.get(agent_id, set()))

    def all_agent_ids(self) -> list[str]:
        return list(self._following.keys())
