"""
oasis_env.py — OASIS Environment (Post Store + Recommendation Engine)

Reimplements OASIS environment.py + recommendation_system.py in Python.
Handles post management, like/repost tracking, and following-based recommendations.
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
    likes: set[str] = field(default_factory=set)     # Agent IDs that liked
    reposts: set[str] = field(default_factory=set)   # Agent IDs that reposted
    original_post_id: str | None = None              # Original post ID if repost


# Default weights per action type (corresponds to OASIS action_space)
_ACTION_WEIGHTS = {
    "post":       0.55,
    "repost":     0.20,
    "like":       0.15,
    "follow":     0.05,
    "do_nothing": 0.05,
}


class OASISEnvironment:
    """
    OASIS simulation environment.
    - Post storage and engagement (like/repost) tracking
    - Following-based + trending mixed recommendations (corresponds to OASIS recommendation_system)
    - Agent action decisions (probability-based, corresponds to OASIS action_space)
    """

    def __init__(self, graph: SocialGraph) -> None:
        self.posts: list[OASISPost] = []
        self._graph = graph
        self._counter = 0

    # ── Post Management ────────────────────────────────────────────────────────

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

    # ── Recommendation Engine ───────────────────────────────────────────────────

    def get_recommended_posts(self, agent_id: str, limit: int = 15) -> list[OASISPost]:
        """
        Corresponds to OASIS recommendation_system.py.
        1. Posts from followed agents (most recent 20)
        2. Global trending (top 10 by likes + reposts combined)
        Deduplicated and limited to 'limit' results.
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

    # ── Action Decision (corresponds to OASIS action_space) ────────────────────

    def decide_action(self, agent_id: str) -> dict:
        """
        Probabilistically decide the agent's action for this turn.
        Returns: {"action": str, "target_post"?: OASISPost, "target_agent_id"?: str}
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
            # Random selection from top 5 trending
            pool = sorted(
                self.posts,
                key=lambda p: len(p.likes) + len(p.reposts),
                reverse=True,
            )[:5] or self.posts
            result["target_post"] = random.choice(pool)

        elif action == "follow" and not_following:
            result["target_agent_id"] = random.choice(not_following)

        return result
