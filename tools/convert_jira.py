"""
Jira JSON → Markdown 변환 스크립트
매뉴얼: sections/s10_jira_fetch.md, s11_jira_aggregate.md, s12_jira_crosslink.md
"""

import json
import os
import re
from collections import defaultdict
from datetime import datetime, date, timedelta

# ── 설정 ───────────────────────────────────────────────────────────────
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
ISSUES_PATH     = os.path.join(BASE_DIR, "issues.json")
ATT_DIR         = os.path.join(BASE_DIR, "_attachments")   # 이슈키 폴더 하위
OUT_DIR         = os.path.join(BASE_DIR, "jira")
RAW_DIR         = os.path.join(OUT_DIR, "raw")
TODAY           = date.today().isoformat()
STALE_DATE      = (datetime.today() - timedelta(days=180)).date()

IMAGE_EXTS  = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".PNG", ".JPG", ".JPEG"}
DOC_EXTS    = {".xlsx", ".xlsm", ".xls", ".pptx", ".ppt", ".pdf", ".docx", ".doc", ".csv", ".txt"}

DECISION_KW = {"결정", "합의", "확정", "채택"}

# ── 유틸 ───────────────────────────────────────────────────────────────
def slugify(text: str) -> str:
    text = re.sub(r'[\\/*?:"<>|]', '', text)
    return re.sub(r'\s+', ' ', text).strip()[:120]

def parse_date(s: str) -> date | None:
    try:
        return date.fromisoformat(s[:10]) if s else None
    except Exception:
        return None

def parse_list(s: str) -> list[str]:
    return [x.strip() for x in re.split(r'[,;|]', s or "") if x.strip()]

def parse_labels(s: str) -> list[str]:
    return [x.lower() for x in parse_list(s)]

# ── 첨부파일 인덱스 ─────────────────────────────────────────────────────
def build_attachment_index(att_dir: str) -> dict[str, dict[str, list[str]]]:
    """
    Returns {issue_key: {"images": [...], "docs": [...], "other": [...]}}
    """
    index: dict[str, dict[str, list[str]]] = {}
    if not os.path.isdir(att_dir):
        return index
    for key in os.listdir(att_dir):
        key_dir = os.path.join(att_dir, key)
        if not os.path.isdir(key_dir):
            continue
        images, docs, other = [], [], []
        for fname in os.listdir(key_dir):
            ext = os.path.splitext(fname)[1]
            if ext in IMAGE_EXTS:
                images.append(fname)
            elif ext in DOC_EXTS:
                docs.append(fname)
            else:
                other.append(fname)
        if images or docs or other:
            index[key] = {"images": sorted(images), "docs": sorted(docs), "other": sorted(other)}
    return index

# ── 매핑 ───────────────────────────────────────────────────────────────
TYPE_MAP = {
    "작업": "spec", "이야기": "spec", "부작업": "spec",
    "epic": "spec", "버그": "spec", "작업관리": "spec",
    "product backlog": "spec",
    "meeting": "meeting", "회의": "meeting", "retrospective": "meeting",
    "decision": "decision", "adr": "decision",
    "guide": "guide", "manual": "guide",
}
STATUS_MAP = {
    "완료": "outdated", "닫힘": "outdated", "해결됨": "outdated",
    "done": "outdated", "closed": "outdated", "resolved": "outdated",
    "취소": "deprecated", "won't fix": "deprecated", "cancelled": "deprecated",
}
DELETE_LABELS = {"test", "temp", "spike"}
LOW_LABELS    = {"decision", "adr", "important"}

def map_type(t: str)   -> str: return TYPE_MAP.get(t.lower(), "spec")
def map_status(s: str) -> str: return STATUS_MAP.get(s.lower(), "active")

# ── Triage ─────────────────────────────────────────────────────────────
def triage(issue: dict) -> str:
    """Returns: 'delete' | 'skip' | 'low'"""
    labels        = parse_labels(issue.get("labels", ""))
    status_raw    = issue.get("status", "").lower()
    itype         = issue.get("type", "").lower()
    comment_count = int(issue.get("comment_count") or 0)
    description   = issue.get("description", "") or ""
    comments      = issue.get("comments", []) or []
    issuelinks    = issue.get("issuelinks", []) or []
    updated       = parse_date(issue.get("updated", ""))

    desc_len = len(description.strip())

    # ── DELETE ──
    if any(l in DELETE_LABELS for l in labels):
        return "delete"
    if status_raw in {"취소", "cancelled", "won't fix"} and comment_count == 0:
        return "delete"
    # 빈 티켓: description 없고 댓글 없음
    if desc_len == 0 and comment_count == 0:
        return "delete"
    # 부작업: description 50자 미만 + 댓글 없음
    if itype == "부작업" and desc_len < 50 and comment_count == 0:
        return "delete"

    # ── LOW ──
    if itype == "epic":
        return "low"
    if any(l in LOW_LABELS for l in labels):
        return "low"
    if desc_len >= 300:
        return "low"
    if len(issuelinks) >= 3:
        return "low"
    # 댓글에 결정/합의/확정/채택 포함
    comment_text = " ".join(c.get("body", "") for c in comments)
    if any(kw in comment_text for kw in DECISION_KW):
        return "low"

    return "skip"

# ── 개별 이슈 MD 생성 ──────────────────────────────────────────────────
def build_issue_md(issue: dict, weight: str, attachments: dict | None = None) -> str:
    key           = issue["key"]
    summary       = issue.get("summary", "")
    itype_raw     = issue.get("type", "")
    status_raw    = issue.get("status", "")
    priority      = issue.get("priority", "")
    assignee      = issue.get("assignee", "")
    reporter      = issue.get("reporter", "")
    components    = issue.get("components", "")
    labels_str    = issue.get("labels", "")
    fix_versions  = issue.get("fix_versions", "")
    created       = issue.get("created", "")
    updated       = issue.get("updated", "")
    resolution    = issue.get("resolution", "")
    description   = (issue.get("description", "") or "").strip()
    comment_count = int(issue.get("comment_count") or 0)
    comments      = issue.get("comments", []) or []
    issuelinks    = issue.get("issuelinks", []) or []
    parent_key    = issue.get("parent_key", "") or ""
    sprint        = issue.get("sprint", "") or ""
    story_points  = issue.get("story_points", "") or ""
    url           = issue.get("url", "")

    vault_type   = map_type(itype_raw)
    vault_status = map_status(status_raw)
    labels       = parse_labels(labels_str)
    tags         = list(dict.fromkeys(t for t in ["jira", itype_raw.lower()] + labels if t))
    comps        = parse_list(components)
    fix_vers     = parse_list(fix_versions)
    att          = attachments or {}

    # ── Frontmatter ──
    fm = ["---", f'title: "{key} {summary}"', f"jira_key: {key}",
          f"type: {vault_type}", f"status: {vault_status}",
          f"origin: jira", f'source: "{url}"', f"graph_weight: {weight}",
          f"priority: {priority}"]
    if assignee:     fm.append(f"assignee: {assignee}")
    if reporter:     fm.append(f"reporter: {reporter}")
    fm.append(f"date: {updated or created or TODAY}")
    fm.append(f"created: {created}")
    if parent_key:   fm.append(f"parent_key: {parent_key}")
    if sprint:       fm.append(f"sprint: {sprint}")
    if story_points: fm.append(f"story_points: {story_points}")
    if comps:        fm.append(f"components: [{', '.join(comps)}]")
    if fix_vers:     fm.append(f"fix_versions: [{', '.join(fix_vers)}]")
    fm.append(f"tags: [{', '.join(tags)}]")
    fm.append("related: []")
    fm.append("---")

    # ── 본문 헤더 테이블 ──
    body = [f"# [{key}] {summary}", "",
            "| 항목 | 값 |", "|------|-----|",
            f"| 유형 | {itype_raw} |", f"| 상태 | {status_raw} |",
            f"| 우선순위 | {priority} |"]
    if assignee:     body.append(f"| 담당자 | {assignee} |")
    if reporter:     body.append(f"| 보고자 | {reporter} |")
    if parent_key:   body.append(f"| 상위 이슈 | [[{parent_key}]] |")
    if sprint:       body.append(f"| 스프린트 | {sprint} |")
    if story_points: body.append(f"| Story Points | {story_points} |")
    if fix_vers:     body.append(f"| 버전 | {', '.join(fix_vers)} |")
    if comps:        body.append(f"| 컴포넌트 | {', '.join(comps)} |")
    if resolution:   body.append(f"| 해결 | {resolution} |")
    body += [f"| 생성일 | {created} |", f"| 수정일 | {updated} |",
             f"| 댓글 수 | {comment_count} |", ""]

    # ── 설명 ──
    if description:
        body += ["## 설명", "", description, ""]

    # ── 관련 이슈 ──
    if issuelinks:
        body += ["## 관련 이슈", ""]
        for link in issuelinks:
            rel = link.get("relation", "")
            lk  = link.get("key", "")
            body.append(f"- {rel}: [[{lk}]]")
        body.append("")

    # ── 댓글 ──
    if comments:
        body.append("## 댓글")
        body.append("")
        for c in comments:
            author = c.get("author", "")
            dt     = c.get("date", "")
            cbody  = (c.get("body", "") or "").strip()
            body.append(f"### {author} ({dt})")
            body.append("")
            body.append(cbody)
            body.append("")

    # ── 첨부파일 ──
    images = att.get("images", [])
    docs   = att.get("docs", [])
    if images or docs:
        body += ["## 첨부파일", ""]
        for img in images:
            body.append(f"![[_attachments/{key}/{img}]]")
        if images:
            body.append("")
        for doc in docs:
            body.append(f"- [{doc}](_attachments/{key}/{doc})")
        body.append("")

    return "\n".join(fm) + "\n\n" + "\n".join(body)


# ── Epic 집계 문서 ─────────────────────────────────────────────────────
def build_epic_md(epic: dict, children: list[dict]) -> str:
    key      = epic["key"]
    summary  = epic.get("summary", "")
    url      = epic.get("url", "")
    assignee = epic.get("assignee", "")
    created  = epic.get("created", "")
    desc     = (epic.get("description", "") or "").strip()

    done_statuses = {"완료", "닫힘", "해결됨", "done", "closed", "resolved"}
    status_counts: dict[str, int] = defaultdict(int)
    for ch in children:
        status_counts[ch.get("status", "기타")] += 1

    total      = len(children)
    has_active = any(k.lower() not in done_statuses for k in status_counts)
    vault_status = "active" if has_active else ("outdated" if total > 0 else "active")

    labels_all: set[str] = set()
    for ch in [epic] + children:
        labels_all.update(parse_labels(ch.get("labels", "")))
    tags = sorted({"jira", "epic"} | labels_all)

    fm = "\n".join([
        "---", f'title: "Epic — {summary}"', f"jira_key: {key}",
        "type: spec", f"status: {vault_status}", "origin: jira_aggregate",
        f'source: "{url}"', "graph_weight: normal", f"date: {TODAY}",
        f"tags: [{', '.join(tags)}]", "related: []", "---",
    ])

    body = [f"# Epic — {summary}", "", f"> {key} | 담당: {assignee or '—'} | 시작: {created}", ""]

    if desc:
        body += ["## 개요", "", desc, ""]

    # 진행 현황
    body += ["## 진행 현황", "", "| 상태 | 건수 | 비율 |", "|------|------|------|"]
    for s, cnt in sorted(status_counts.items(), key=lambda x: -x[1]):
        pct = f"{cnt * 100 // total}%" if total else "—"
        body.append(f"| {s} | {cnt} | {pct} |")
    body += [f"| **합계** | **{total}** | — |", ""]

    # 핵심 결정사항 (댓글에서 추출)
    decisions = []
    for ch in children:
        for c in (ch.get("comments", []) or []):
            cbody = c.get("body", "") or ""
            if any(kw in cbody for kw in DECISION_KW):
                snippet = cbody[:80].replace("\n", " ")
                decisions.append(f"- ({c.get('date','')}) {snippet}… [[{ch['key']}]]")
    if decisions:
        body += ["## 핵심 결정사항", ""] + decisions[:10] + [""]

    # 하위 이슈
    if children:
        body += ["## 하위 이슈", "", "| Key | 제목 | 상태 | 담당 | SP |",
                 "|-----|------|------|------|-----|"]
        for ch in children[:50]:
            sp = ch.get("story_points", "") or "—"
            body.append(
                f"| [[{ch['key']}]] | {ch.get('summary','')[:60]} "
                f"| {ch.get('status','')} | {ch.get('assignee','—')} | {sp} |"
            )
        if len(children) > 50:
            body.append(f"\n> ... 외 {len(children) - 50}건 (raw/ 폴더 참조)")
        body.append("")

    body.append("## 관련 문서\n\n<!-- s12 교차 링크에서 주입 -->")
    return fm + "\n\n" + "\n".join(body)


# ── Release 집계 문서 ──────────────────────────────────────────────────
def build_release_md(version: str, issues: list[dict]) -> str:
    done_statuses = {"완료", "닫힘", "해결됨", "done", "closed", "resolved"}
    total = len(issues)

    status_counts: dict[str, int] = defaultdict(int)
    for iss in issues:
        status_counts[iss.get("status", "기타")] += 1

    done_count   = sum(v for k, v in status_counts.items() if k.lower() in done_statuses)
    completion   = f"{done_count * 100 // total}%" if total else "—"
    has_active   = any(k.lower() not in done_statuses for k in status_counts)
    vault_status = "active" if has_active else "outdated"
    active_issues = [i for i in issues if i.get("status", "").lower() not in done_statuses]

    fm = "\n".join([
        "---", f'title: "Release {version}"', "type: spec",
        f"status: {vault_status}", "origin: jira_aggregate",
        "graph_weight: normal", f"date: {TODAY}",
        "tags: [jira, release]", "related: []", "---",
    ])

    body = [f"# Release {version}", "",
            f"> 전체 이슈 {total}건 | 완료율 {completion}", "",
            "## 상태 현황", "", "| 상태 | 건수 | 비율 |", "|------|------|------|"]
    for s, cnt in sorted(status_counts.items(), key=lambda x: -x[1]):
        pct = f"{cnt * 100 // total}%" if total else "—"
        body.append(f"| {s} | {cnt} | {pct} |")
    body += [f"| **합계** | **{total}** | — |", ""]

    if active_issues:
        body += ["## 미완료 이슈", "", "| Key | 제목 | 상태 | 담당 |",
                 "|-----|------|------|------|"]
        for iss in active_issues[:30]:
            body.append(
                f"| [[{iss['key']}]] | {iss.get('summary','')[:60]} "
                f"| {iss.get('status','')} | {iss.get('assignee','—')} |"
            )
        if len(active_issues) > 30:
            body.append(f"\n> ... 외 {len(active_issues) - 30}건")
        body.append("")

    return fm + "\n\n" + "\n".join(body)


# ── 메인 ───────────────────────────────────────────────────────────────
def main():
    print("issues.json 로드 중...")
    with open(ISSUES_PATH, encoding="utf-8") as f:
        issues = json.load(f)
    print(f"  총 {len(issues)}개 이슈")

    print("첨부파일 인덱스 구성 중...")
    att_index = build_attachment_index(ATT_DIR)
    att_total = sum(len(v["images"]) + len(v["docs"]) for v in att_index.values())
    print(f"  첨부파일 있는 이슈: {len(att_index)}개 | 총 파일: {att_total}개")

    os.makedirs(RAW_DIR, exist_ok=True)

    stats = {"delete": 0, "skip": 0, "low": 0}
    epic_issues: list[dict]            = []
    release_map: dict[str, list[dict]] = defaultdict(list)
    # parent_key 기반 epic→children 매핑
    parent_map:  dict[str, list[dict]] = defaultdict(list)

    print("Triage + 개별 MD 생성 중...")
    for issue in issues:
        decision = triage(issue)

        if decision == "delete":
            stats["delete"] += 1
            continue

        stats[decision] += 1

        # parent_map 구성 (parent_key가 있으면 등록)
        pk = issue.get("parent_key", "")
        if pk:
            parent_map[pk].append(issue)

        key   = issue["key"]
        fpath = os.path.join(RAW_DIR, f"{key}.md")
        content = build_issue_md(issue, weight=decision, attachments=att_index.get(key))
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)

        if issue.get("type", "").lower() == "epic":
            epic_issues.append(issue)

        fv = issue.get("fix_versions", "").strip()
        if fv:
            for v in re.split(r'[,;|]', fv):
                v = v.strip()
                if v:
                    release_map[v].append(issue)

    print(f"  삭제: {stats['delete']}개 | skip: {stats['skip']}개 | low: {stats['low']}개")

    # ── Epic 집계 문서 ─────────────────────────────────────────────────
    print(f"\nEpic 집계 문서 생성 중... ({len(epic_issues)}개 Epic)")
    for epic in epic_issues:
        epic_key = epic["key"]
        # parent_key 기반 우선, fallback으로 fix_versions 동일 이슈
        children = parent_map.get(epic_key, [])
        if not children:
            epic_fv = epic.get("fix_versions", "").strip()
            if epic_fv:
                children = [
                    i for i in issues
                    if i.get("fix_versions", "").strip() == epic_fv
                    and i.get("type", "").lower() != "epic"
                    and triage(i) != "delete"
                ]

        fname = f"Epic — {slugify(epic.get('summary', epic_key))}.md"
        fpath = os.path.join(OUT_DIR, fname)
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(build_epic_md(epic, children))

    print(f"  {len(epic_issues)}개 Epic 집계 문서 생성 완료")

    # ── Release 집계 문서 ─────────────────────────────────────────────
    release_candidates = {v: iss for v, iss in release_map.items() if len(iss) >= 3}
    print(f"\nRelease 집계 문서 생성 중... ({len(release_candidates)}개 버전)")
    for version, version_issues in release_candidates.items():
        fpath = os.path.join(OUT_DIR, f"Release {slugify(version)}.md")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(build_release_md(version, version_issues))
    print(f"  {len(release_candidates)}개 Release 집계 문서 생성 완료")

    # ── 최종 통계 ─────────────────────────────────────────────────────
    raw_count = len(os.listdir(RAW_DIR))
    agg_count = len([f for f in os.listdir(OUT_DIR) if f.endswith(".md")])
    print(f"\n완료!")
    print(f"  raw/ 개별 이슈: {raw_count}개")
    print(f"  집계 문서: {agg_count}개")
    print(f"  출력 경로: {OUT_DIR}")


if __name__ == "__main__":
    main()
