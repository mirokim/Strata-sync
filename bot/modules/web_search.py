"""
web_search.py — DuckDuckGo HTML 검색 (API 키 불필요)

vault 검색 결과를 보강하거나, 볼트에 없는 최신 정보 조회에 사용.
"""
import html
import re
import urllib.parse
import urllib.request

_DDG_URL = "https://html.duckduckgo.com/html/"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
_TIMEOUT = 10


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """
    DuckDuckGo에서 검색, 상위 max_results개 결과 반환.
    결과: [{"title": str, "url": str, "snippet": str}]
    실패 시 [] 반환.
    """
    params = urllib.parse.urlencode({"q": query, "kl": "kr-kr"})
    req = urllib.request.Request(
        _DDG_URL,
        data=params.encode("utf-8"),
        headers={
            "User-Agent": _UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    results = []

    # 결과 블록: <a class="result__a"> 제목 + URL + <a class="result__snippet"> 요약
    title_url_re = re.compile(
        r'<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL
    )
    snippet_re = re.compile(
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL
    )

    titles_urls = title_url_re.findall(body)
    snippets = snippet_re.findall(body)

    for i, (url, raw_title) in enumerate(titles_urls[:max_results]):
        clean_title = html.unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
        raw_snip = snippets[i] if i < len(snippets) else ""
        clean_snip = html.unescape(re.sub(r"<[^>]+>", "", raw_snip)).strip()
        # DuckDuckGo redirect URL 정리
        if url.startswith("//duckduckgo.com/l/?"):
            m = re.search(r"uddg=([^&]+)", url)
            if m:
                url = urllib.parse.unquote(m.group(1))
        if clean_title:
            results.append({"title": clean_title, "url": url, "snippet": clean_snip})

    return results


def build_web_context(results: list[dict], max_chars: int = 2000) -> str:
    """검색 결과를 RAG 컨텍스트 문자열로 변환."""
    if not results:
        return ""
    parts = ["## 웹 검색 결과\n"]
    total = len(parts[0])
    for r in results:
        chunk = f"- **{r['title']}**\n  {r['snippet']}\n  출처: {r['url']}\n\n"
        if total + len(chunk) > max_chars:
            break
        parts.append(chunk)
        total += len(chunk)
    return "".join(parts)
