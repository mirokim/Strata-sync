"""
claude_client.py — Claude Haiku API calls (for keyword discovery)
"""
import json
import urllib.request
import urllib.error

from .constants import DEFAULT_HAIKU_MODEL


class ClaudeClient:
    API_URL = "https://api.anthropic.com/v1/messages"
    DEFAULT_MODEL = DEFAULT_HAIKU_MODEL

    def __init__(self, api_key: str, model: str = DEFAULT_HAIKU_MODEL):
        self.api_key = api_key
        self.model = model

    def complete(self, system: str, user: str, max_tokens: int = 1024,
                 cache_system: bool = False) -> str:
        if not self.api_key:
            return ""
        system_field = (
            [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
            if cache_system else system
        )
        payload = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system_field,
            "messages": [{"role": "user", "content": user}],
        }).encode("utf-8")

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        if cache_system:
            headers["anthropic-beta"] = "prompt-caching-2024-07-31"
        req = urllib.request.Request(
            self.API_URL,
            data=payload,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                return data["content"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Claude API {e.code}: {body[:200]}")

    def discover_keywords(self, doc_samples: list[dict]) -> list[dict]:
        """
        Extract core keywords + hub documents from document samples.
        doc_samples: [{"stem": "...", "title": "...", "body_snippet": "..."}]
        returns: [{"keyword": "...", "hub_stem": "...", "display": "..."}]
        """
        sample_text = "\n\n".join(
            f"[{d['stem']}] {d['title']}\n{d['body_snippet'][:300]}"
            for d in doc_samples[:20]
        )
        system = (
            "You are a knowledge graph expert. "
            "Find core domain keywords that appear repeatedly across multiple documents in the list below, "
            "and designate a 'hub document' (the document that explains it most) for each keyword.\n"
            "Response format: Output only a JSON array. No other text.\n"
            'Example: [{"keyword":"CharacterA","hub_stem":"07. Character _ CharacterA_123","display":"CharacterA"}]'
        )
        user = f"Document list:\n\n{sample_text}\n\nOutput core keyword JSON array:"
        raw = self.complete(system, user, max_tokens=1500)

        # JSON parsing
        try:
            # Remove markdown code blocks
            if "```" in raw:
                parts = raw.split("```")
                if len(parts) > 1:
                    raw = parts[1].lstrip("json").strip()
            return json.loads(raw)
        except Exception:
            return []

    def suggest_hub_for_keyword(self, keyword: str, candidates: list[str]) -> str:
        """Select a hub document from candidates for a specific keyword."""
        cand_text = "\n".join(f"- {s}" for s in candidates[:10])
        system = "Output only one hub (representative) document stem for the keyword from the document list below. No other text."
        user = f"Keyword: {keyword}\n\nCandidate documents:\n{cand_text}\n\nHub stem:"
        result = self.complete(system, user, max_tokens=100)
        # Verify it's one of the candidates
        for cand in candidates:
            if cand.strip() in result or result.strip() in cand:
                return cand.strip()
        return candidates[0] if candidates else ""
