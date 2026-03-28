"""
slack_utils.py — Slack 이벤트 파싱 + private file 다운로드 유틸리티

분리 이유: bot.py의 클로저 내부에 있던 로직을 모듈 레벨로 추출하여
단독 유닛 테스트가 가능하도록 함.
"""
from __future__ import annotations


def extract_slack_files(event: dict) -> list | None:
    """
    Slack 이벤트에서 파일 목록 추출.

    Slack API 버전에 따라:
      - 신형: event["files"] = [{...}, ...]
      - 구형: event["file"]  = {...}   (단수)
    두 형식을 모두 지원하며, 없으면 None 반환.
    """
    files = event.get("files")
    if files:           # 빈 리스트([])는 falsy → file 단수로 낙하
        return files
    single = event.get("file")
    return [single] if single else None


def download_slack_file(
    url: str,
    bot_token: str,
    log_fn=None,
) -> bytes | None:
    """
    Slack private file URL에서 이진 데이터 다운로드.

    방법1: Authorization 헤더 (커스텀 세션으로 리다이렉트 후에도 유지)
    방법2: ?token=... 쿼리 파라미터 (레거시 폴백)

    두 방법 모두 실패하면 None 반환.
    Slack 앱에 files:read 스코프가 없으면 HTML 로그인 페이지가 반환됨.
    """
    import requests as _req

    def _log(msg: str) -> None:
        if log_fn:
            log_fn(msg)

    def _is_html(data: bytes) -> bool:
        return bool(data) and data[:1] == b"<"

    # 방법 1: Authorization 헤더 — rebuild_auth 오버라이드로 리다이렉트 후에도 유지
    class _SlackSession(_req.Session):
        def rebuild_auth(self, prepared_request, response):  # type: ignore[override]
            prepared_request.headers["Authorization"] = f"Bearer {bot_token}"

    try:
        sess = _SlackSession()
        r1 = sess.get(
            url,
            headers={"Authorization": f"Bearer {bot_token}"},
            allow_redirects=True,
            timeout=15,
        )
        _log(f"[Vision] 방법1 status={r1.status_code} url={r1.url[:70]!r}")
        if r1.ok and r1.content and not _is_html(r1.content):
            return r1.content
    except Exception as e:
        _log(f"[Vision] 방법1 예외: {e}")

    # 방법 2: 토큰을 쿼리 파라미터로 (files:read 없어도 동작하는 경우 있음)
    try:
        sep = "&" if "?" in url else "?"
        r2 = _req.get(f"{url}{sep}token={bot_token}", allow_redirects=True, timeout=15)
        _log(f"[Vision] 방법2 status={r2.status_code} url={r2.url[:70]!r}")
        if r2.ok and r2.content and not _is_html(r2.content):
            return r2.content
    except Exception as e:
        _log(f"[Vision] 방법2 예외: {e}")

    return None
