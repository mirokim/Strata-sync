"""
social_graph.py — OASIS Social Network Graph

Generates a realistic follow network using the Barabási-Albert preferential attachment model.
Reimplements OASIS social_graph.py in Python.
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
        Generate a social graph using the Barabási-Albert model.
        m: number of existing nodes each new node connects to (default 2).
        Nodes with more followers have a higher probability of receiving new follows.
        """
        graph = cls(agent_ids)
        if len(agent_ids) < 2:
            return graph

        # Initial clique (first m+1 nodes follow each other)
        initial = agent_ids[: min(m + 1, len(agent_ids))]
        for a in initial:
            for b in initial:
                if a != b:
                    graph.follow(a, b)

        # Add remaining nodes sequentially — preferential attachment
        for new_node in agent_ids[len(initial) :]:
            for target in graph._preferential_attachment(new_node, m):
                graph.follow(new_node, target)

        return graph

    def _preferential_attachment(self, exclude: str, m: int) -> list[str]:
        """Select m connection targets with weights proportional to follower count."""
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

    # ── Follow Operations ──────────────────────────────────────────────────────

    def follow(self, from_id: str, to_id: str) -> None:
        self._following.setdefault(from_id, set()).add(to_id)
        self._followers.setdefault(to_id, set()).add(from_id)

    def unfollow(self, from_id: str, to_id: str) -> None:
        self._following.get(from_id, set()).discard(to_id)
        self._followers.get(to_id, set()).discard(from_id)

    # ── Queries ────────────────────────────────────────────────────────────────

    def get_following(self, agent_id: str) -> list[str]:
        return list(self._following.get(agent_id, set()))

    def get_followers(self, agent_id: str) -> list[str]:
        return list(self._followers.get(agent_id, set()))

    def follower_count(self, agent_id: str) -> int:
        return len(self._followers.get(agent_id, set()))

    def all_agent_ids(self) -> list[str]:
        return list(self._following.keys())
