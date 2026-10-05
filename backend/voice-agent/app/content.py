"""Loads the exported portfolio content.

`content/portfolio.json` is generated from `frontend/src/content/*.ts` by
`scripts/export_content.mjs`. Keeping one source of truth means the agent can
never claim something the site doesn't say.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTENT_FILE = Path(__file__).resolve().parent.parent / "content" / "portfolio.json"

REQUIRED_KEYS = ("profile", "skillGroups", "experience", "projects", "socials")


class ContentError(RuntimeError):
    """Raised when the exported portfolio content is missing or malformed."""


@lru_cache(maxsize=1)
def load_content() -> dict[str, Any]:
    if not CONTENT_FILE.exists():
        raise ContentError(
            f"{CONTENT_FILE} not found. Run: node scripts/export_content.mjs"
        )

    try:
        data = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContentError(f"{CONTENT_FILE} is not valid JSON: {exc}") from exc

    missing = [key for key in REQUIRED_KEYS if key not in data]
    if missing:
        raise ContentError(
            f"{CONTENT_FILE} is missing {', '.join(missing)}. "
            "Re-run: node scripts/export_content.mjs"
        )

    return data
