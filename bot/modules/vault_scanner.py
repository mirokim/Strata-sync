"""
vault_scanner.py — 볼트 파일 스캔 및 파싱
"""
import os
import re
import yaml
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class VaultDoc:
    path: str           # 절대 경로
    fname: str          # 파일명
    stem: str           # 확장자 제외 이름
    folder: str         # 상위 폴더명
    title: str = ""
    tags: list = field(default_factory=list)
    doc_type: str = "reference"
    date_str: str = ""
    body: str = ""      # frontmatter 제외 본문
    raw: str = ""       # 전체 원본 텍스트
    body_len: int = 0


def load_frontmatter(text: str) -> tuple[dict, str]:
    """frontmatter 파싱 → (dict, body)"""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            try:
                fm = yaml.safe_load(text[3:end]) or {}
                return fm, text[end + 4:]
            except Exception:
                pass
    return {}, text


def scan_vault(vault_path: str) -> list[VaultDoc]:
    """볼트 전체 .md 파일 스캔"""
    docs: list[VaultDoc] = []
    vault = Path(vault_path)
    if not vault.exists():
        return docs

    for md_file in vault.rglob("*.md"):
        # .strata-sync, .obsidian 등 숨김 폴더 제외
        parts = md_file.parts
        if any(p.startswith(".") for p in parts):
            continue

        try:
            raw = md_file.read_text(encoding="utf-8")
        except Exception:
            continue

        fm, body = load_frontmatter(raw)
        stem = md_file.stem
        folder = md_file.parent.name

        doc = VaultDoc(
            path=str(md_file),
            fname=md_file.name,
            stem=stem,
            folder=folder,
            title=str(fm.get("title", stem)),
            tags=fm.get("tags", []) or [],
            doc_type=str(fm.get("type", "reference")),
            date_str=str(fm.get("date", ""))[:10],
            body=body,
            raw=raw,
            body_len=len(body.strip()),
        )
        docs.append(doc)

    return docs


def find_active_folders(vault_path: str) -> list[str]:
    """active_YYYYMMDD 폴더 목록 (날짜 역순)"""
    vault = Path(vault_path)
    pattern = re.compile(r"^active_\d{8}$")
    folders = [
        str(vault / d.name)
        for d in vault.iterdir()
        if d.is_dir() and pattern.match(d.name)
    ]
    return sorted(folders, reverse=True)


def get_wikilinks(text: str) -> list[str]:
    """본문에서 [[stem]] 또는 [[stem|display]] 추출 → stem 리스트"""
    return re.findall(r"\[\[(.*?)(?:\|.*?)?\]\]", text, re.DOTALL)
