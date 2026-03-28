"""
web_search.py — DuckDuckGo HTML search (no API key required)

Used to augment vault search results or look up latest info not in the vault.
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
    Search DuckDuckGo and return top max_results results.
    Results: [{"title": str, "url": str, "snippet": str}]
    Returns [] on failure.
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

    # Result blocks: <a class="result__a"> title + URL + <a class="result__snippet"> snippet
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
        # Clean up DuckDuckGo redirect URL
        if url.startswith("//duckduckgo.com/l/?"):
            m = re.search(r"uddg=([^&]+)", url)
            if m:
                url = urllib.parse.unquote(m.group(1))
        if clean_title:
            results.append({"title": clean_title, "url": url, "snippet": clean_snip})

    return results


def build_web_context(results: list[dict], max_chars: int = 2000) -> str:
    """Convert search results to a RAG context string."""
    if not results:
        return ""
    parts = ["## Web Search Results\n"]
    total = len(parts[0])
    for r in results:
        chunk = f"- **{r['title']}**\n  {r['snippet']}\n  Source: {r['url']}\n\n"
        if total + len(chunk) > max_chars:
            break
        parts.append(chunk)
        total += len(chunk)
    return "".join(parts)
