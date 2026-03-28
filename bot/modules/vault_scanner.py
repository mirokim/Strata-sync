"""
vault_scanner.py — Vault file scanning and parsing
"""
import os
import re
import yaml
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class VaultDoc:
    path: str           # Absolute path
    fname: str          # Filename
    stem: str           # Name without extension
    folder: str         # Parent folder name
    title: str = ""
    tags: list = field(default_factory=list)
    doc_type: str = "reference"
    date_str: str = ""
    body: str = ""      # Body excluding frontmatter
    raw: str = ""       # Full original text
    body_len: int = 0


def load_frontmatter(text: str) -> tuple[dict, str]:
    """Parse frontmatter → (dict, body)"""
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
    """Scan all .md files in the vault"""
    docs: list[VaultDoc] = []
    vault = Path(vault_path)
    if not vault.exists():
        return docs

    for md_file in vault.rglob("*.md"):
        # Exclude hidden folders like .strata-sync, .obsidian
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
    """List of active_YYYYMMDD folders (reverse date order)"""
    vault = Path(vault_path)
    pattern = re.compile(r"^active_\d{8}$")
    folders = [
        str(vault / d.name)
        for d in vault.iterdir()
        if d.is_dir() and pattern.match(d.name)
    ]
    return sorted(folders, reverse=True)


def get_wikilinks(text: str) -> list[str]:
    """Extract [[stem]] or [[stem|display]] from body text → list of stems"""
    return re.findall(r"\[\[(.*?)(?:\|.*?)?\]\]", text, re.DOTALL)
