"""
claude_client.py — Claude Haiku API 호출 (keyword 발견용)
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
        문서 샘플에서 핵심 키워드 + 허브 문서 추출
        doc_samples: [{"stem": "...", "title": "...", "body_snippet": "..."}]
        returns: [{"keyword": "...", "hub_stem": "...", "display": "..."}]
        """
        sample_text = "\n\n".join(
            f"[{d['stem']}] {d['title']}\n{d['body_snippet'][:300]}"
            for d in doc_samples[:20]
        )
        system = (
            "당신은 지식 그래프 전문가입니다. "
            "아래 문서 목록에서 여러 문서에서 반복 등장하는 핵심 도메인 키워드를 찾고, "
            "각 키워드의 '허브 문서'(가장 많이 설명하는 문서)를 지정하세요.\n"
            "응답 형식: JSON 배열만 출력. 다른 텍스트 금지.\n"
            '예시: [{"keyword":"스칼렛","hub_stem":"07. 캐릭터 _ 스칼렛_123","display":"스칼렛"}]'
        )
        user = f"문서 목록:\n\n{sample_text}\n\n핵심 키워드 JSON 배열 출력:"
        raw = self.complete(system, user, max_tokens=1500)

        # JSON 파싱
        try:
            # 마크다운 코드블록 제거
            if "```" in raw:
                parts = raw.split("```")
                if len(parts) > 1:
                    raw = parts[1].lstrip("json").strip()
            return json.loads(raw)
        except Exception:
            return []

    def suggest_hub_for_keyword(self, keyword: str, candidates: list[str]) -> str:
        """특정 키워드에 대해 후보 문서 중 허브 문서 선택"""
        cand_text = "\n".join(f"- {s}" for s in candidates[:10])
        system = "아래 문서 목록 중 키워드의 허브(대표) 문서 stem을 하나만 출력하세요. 다른 텍스트 금지."
        user = f"키워드: {keyword}\n\n후보 문서:\n{cand_text}\n\n허브 stem:"
        result = self.complete(system, user, max_tokens=100)
        # 후보 중 하나인지 확인
        for cand in candidates:
            if cand.strip() in result or result.strip() in cand:
                return cand.strip()
        return candidates[0] if candidates else ""
