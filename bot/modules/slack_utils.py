"""
slack_utils.py — Slack event parsing + private file download utilities

Separation reason: extracted logic from closures inside bot.py to module level
to enable standalone unit testing.
"""
from __future__ import annotations


def extract_slack_files(event: dict) -> list | None:
    """
    Extract file list from a Slack event.

    Depending on Slack API version:
      - New: event["files"] = [{...}, ...]
      - Old: event["file"]  = {...}   (singular)
    Supports both formats, returns None if no files.
    """
    files = event.get("files")
    if files:           # Empty list ([]) is falsy → falls through to singular file
        return files
    single = event.get("file")
    return [single] if single else None


def download_slack_file(
    url: str,
    bot_token: str,
    log_fn=None,
) -> bytes | None:
    """
    Download binary data from a Slack private file URL.

    Method 1: Authorization header (persists after redirect via custom session)
    Method 2: ?token=... query parameter (legacy fallback)

    Returns None if both methods fail.
    If the Slack app lacks files:read scope, an HTML login page will be returned.
    """
    import requests as _req

    def _log(msg: str) -> None:
        if log_fn:
            log_fn(msg)

    def _is_html(data: bytes) -> bool:
        return bool(data) and data[:1] == b"<"

    # Method 1: Authorization header — persists after redirect via rebuild_auth override
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
        _log(f"[Vision] Method 1 status={r1.status_code} url={r1.url[:70]!r}")
        if r1.ok and r1.content and not _is_html(r1.content):
            return r1.content
    except Exception as e:
        _log(f"[Vision] Method 1 exception: {e}")

    # Method 2: token as query parameter (may work even without files:read)
    try:
        sep = "&" if "?" in url else "?"
        r2 = _req.get(f"{url}{sep}token={bot_token}", allow_redirects=True, timeout=15)
        _log(f"[Vision] Method 2 status={r2.status_code} url={r2.url[:70]!r}")
        if r2.ok and r2.content and not _is_html(r2.content):
            return r2.content
    except Exception as e:
        _log(f"[Vision] Method 2 exception: {e}")

    return None
