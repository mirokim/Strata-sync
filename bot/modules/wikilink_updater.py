"""
wikilink_updater.py — keyword_index.json based wikilink injection + cluster link enhancement
Integrates inject_keywords.py + enhance_wikilinks.py logic
"""
import re
from pathlib import Path

LINK_PAT = re.compile(r"\[\[.*?\]\]", re.DOTALL)


def _mask_links(text: str) -> tuple[str, list[str]]:
    saved: list[str] = []
    def r(m):
        idx = len(saved)
        saved.append(m.group(0))
        return f"\x00WL{idx}\x00"
    return LINK_PAT.sub(r, text), saved


def _restore_links(masked: str, saved: list[str]) -> str:
    def r(m):
        return saved[int(m.group(1))]
    return re.sub(r"\x00WL(\d+)\x00", r, masked)


def _get_fm_end(text: str) -> int:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return end + 4
    return 0


def inject_keywords(text: str, keyword_map: dict) -> tuple[str, list[str]]:
    """keyword_map: {keyword: (hub_stem, display)} → inject wikilink at first occurrence"""
    fm_end = _get_fm_end(text)
    fm = text[:fm_end]
    body = text[fm_end:]
    masked, saved = _mask_links(body)
    injected = []

    for keyword, (hub_stem, display) in sorted(keyword_map.items(), key=lambda x: -len(x[0])):
        pat = re.compile(re.escape(keyword))
        for m in pat.finditer(masked):
            link = f"[[{hub_stem}|{display}]]"
            # Immediately mask new links after injection to prevent later keywords from corrupting them
            placeholder = f"\x00WL{len(saved)}\x00"
            saved.append(link)
            masked = masked[:m.start()] + placeholder + masked[m.end():]
            injected.append(keyword)
            break

    return fm + _restore_links(masked, saved), injected


def inject_cluster_links(content: str, related_stems: list[str]) -> str:
    """Add '## Related Documents' section at the bottom of the file (update if already exists)"""
    marker = "## 관련 문서"  # Keep Korean marker for vault compatibility
    link_block = "\n".join(f"- [[{s}]]" for s in related_stems[:10])
    new_section = f"{marker}\n{link_block}\n"

    if marker in content:
        # Replace existing section
        return re.sub(
            rf"{re.escape(marker)}.*?(?=\n##|\Z)",
            new_section,
            content,
            flags=re.DOTALL,
        )
    return content.rstrip() + f"\n\n{new_section}"


def process_folder(
    folder_path: str,
    keyword_map: dict,
    log_fn=print,
) -> dict:
    """
    Process an active folder:
    1. Inject wikilinks based on keyword_map
    2. Add cluster links based on tags
    returns: {"updated": int, "keyword_hits": {keyword: count}}
    """
    import yaml

    folder = Path(folder_path)
    md_files = [f for f in folder.iterdir() if f.suffix == ".md" and not f.stem.startswith("index_")]
    log_fn(f"  Target files: {len(md_files)} in {folder.name}")

    # Collect metadata (for tag-based clustering)
    meta: dict = {}
    for f in md_files:
        try:
            raw = f.read_text(encoding="utf-8")
        except Exception:
            continue
        fm = {}
        if raw.startswith("---"):
            end = raw.find("\n---", 3)
            if end != -1:
                try:
                    fm = yaml.safe_load(raw[3:end]) or {}
                except Exception:
                    pass
        meta[f.stem] = {"tags": fm.get("tags") or [], "raw": raw, "path": f}

    # Tag → stem mapping
    tag_groups: dict[str, list[str]] = {}
    for stem, info in meta.items():
        for tag in info["tags"]:
            tag_groups.setdefault(tag, []).append(stem)

    updated = 0
    keyword_hits: dict[str, int] = {}

    for stem, info in meta.items():
        original = info["raw"]
        text = original

        # 1. Keyword wikilink injection
        if keyword_map:
            text, injected = inject_keywords(text, keyword_map)
            for kw in injected:
                keyword_hits[kw] = keyword_hits.get(kw, 0) + 1

        # 2. Cluster links
        related = []
        for tag in info["tags"]:
            for other in tag_groups.get(tag, []):
                if other != stem and other not in related:
                    related.append(other)
        if related:
            text = inject_cluster_links(text, related[:10])

        if text != original:
            info["path"].write_text(text, encoding="utf-8")
            updated += 1

    log_fn(f"  Updated: {updated} files")
    return {"updated": updated, "keyword_hits": keyword_hits}
