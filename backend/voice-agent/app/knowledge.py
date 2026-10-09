"""A deliberately small RAG layer for Kaira.

Before this, the whole résumé rode along in the system prompt on every turn.
That caps how much Sahil can tell the agent about himself and pays for the full
corpus on every reply. Now the prompt carries only a short fact sheet (see
`prompt.build_core_facts`) and each turn gets the handful of passages relevant
to what the visitor just asked.

Shape, end to end:

- **Corpus.** `content/portfolio.json` (the site's own content, one chunk per
  job / project / skill group / profile facet) plus any Markdown under
  `content/knowledge/` — free-form notes that never have to appear on the site.
  Each `## ` section of a note is one chunk.
- **Seed.** At startup every chunk is embedded once with OpenAI and the vectors
  are cached in `agent_data/knowledge_index.json`, keyed by a hash of the chunk
  text. A restart re-embeds only what changed, so editing a note costs one call.
- **Retrieve.** One embedding call for the visitor's question, cosine against
  an in-memory numpy matrix, top-k. No vector database: the corpus is tens of
  chunks, and a matrix multiply over it takes microseconds.

Retrieval sits on the latency path of a spoken reply, so it is bounded: a
timeout on the query embedding, an LRU over repeated queries, and a keyword
fallback so a slow or failed embedding degrades to a worse answer, never a
silent one.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .config import settings
from .content import load_content

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
NOTES_DIR = ROOT / "content" / "knowledge"
# agent_data/ is already the writable runtime directory (and a volume in
# compose), so the cache survives restarts without a new mount.
INDEX_FILE = Path("agent_data") / "knowledge_index.json"

EMBED_MODEL = "text-embedding-3-small"
TOP_K = 4
# Cosine floor for text-embedding-3-small. Low on purpose: a Hindi question
# against English passages scores lower than its English twin, and a slightly
# off-topic passage costs a few tokens where a dropped relevant one costs a
# wrong answer.
MIN_SCORE = 0.2
QUERY_TIMEOUT_S = 1.5
# Projects with many features are split so one chunk stays one topic.
FEATURES_PER_CHUNK = 4


@dataclass(frozen=True)
class Chunk:
    id: str
    title: str
    text: str

    @property
    def digest(self) -> str:
        return hashlib.sha256(f"{EMBED_MODEL}\n{self.title}\n{self.text}".encode()).hexdigest()

    def render(self) -> str:
        return f"[{self.title}]\n{self.text}"


# --- corpus -----------------------------------------------------------------


def _lines(*parts: str | None) -> str:
    return "\n".join(p for p in parts if p and p.strip())


def _profile_chunks(profile: dict[str, Any]) -> list[Chunk]:
    education = profile.get("education", {}) or {}
    stats = profile.get("stats", []) or []
    return [
        Chunk(
            "profile:about",
            "About Sahil",
            _lines(
                f"{profile.get('name', '')} ({profile.get('handle', '')}), {profile.get('title', '')}.",
                f"Also described as: {', '.join(profile.get('roles', []) or [])}.",
                profile.get("tagline"),
                f"Based in {profile.get('location', '')}. Availability: {profile.get('availability', '')}.",
                *(profile.get("bio", []) or []),
            ),
        ),
        Chunk(
            "profile:education",
            "Education",
            f"{education.get('degree', '')}, {education.get('school', '')} "
            f"({education.get('period', '')}), CGPA {education.get('cgpa', '')}.",
        ),
        Chunk(
            "profile:stats",
            "Headline numbers",
            "\n".join(f"- {s.get('value', '')}: {s.get('label', '')}" for s in stats),
        ),
    ]


def _contact_chunk(profile: dict[str, Any], socials: list[dict[str, Any]]) -> Chunk:
    return Chunk(
        "profile:contact",
        "Contact and links",
        _lines(
            f"Email: {profile.get('email', '')}",
            f"Phone: {profile.get('phone', '')}",
            f"Resume: {profile.get('resumeUrl', 'https://resume.sahell.in')}",
            *(f"{s.get('name', '')} ({s.get('handle', '')}): {s.get('url', '')}" for s in socials),
        ),
    )


def _job_chunk(job: dict[str, Any]) -> Chunk:
    current = " (current role)" if job.get("current") else ""
    stack = job.get("stack", []) or []
    return Chunk(
        f"job:{job.get('company', '')}",
        f"Experience: {job.get('role', '')} at {job.get('company', '')}",
        _lines(
            f"{job.get('role', '')} at {job.get('company', '')}, {job.get('period', '')}{current}.",
            job.get("summary"),
            *(f"- {h}" for h in job.get("highlights", []) or []),
            f"Stack: {', '.join(stack)}" if stack else None,
        ),
    )


def _project_chunks(project: dict[str, Any]) -> list[Chunk]:
    name = project.get("name", "")
    stack = project.get("stack", []) or []
    links = project.get("links", {}) or {}
    demo = links.get("demo")
    chunks = [
        Chunk(
            f"project:{name}",
            f"Project: {name}",
            _lines(
                f"{name}: {project.get('tagline', '')}",
                project.get("description"),
                *(f"- {h}" for h in project.get("highlights", []) or []),
                f"Stack: {', '.join(stack)}" if stack else None,
                f"GitHub: {links['github']}" if links.get("github") else None,
                # example.com is the placeholder the site uses until a real
                # demo exists; reading it out would be a fabrication.
                f"Demo: {demo}" if demo and "example.com" not in demo else None,
            ),
        )
    ]
    features = project.get("features", []) or []
    for i in range(0, len(features), FEATURES_PER_CHUNK):
        batch = features[i : i + FEATURES_PER_CHUNK]
        chunks.append(
            Chunk(
                f"project:{name}:features:{i // FEATURES_PER_CHUNK}",
                f"Project: {name}, how it works",
                "\n".join(f"- {f['title']}: {f['detail']}" for f in batch),
            )
        )
    return chunks


def _skill_chunk(group: dict[str, Any]) -> Chunk:
    label = group.get("label", "")
    return Chunk(f"skills:{label}", f"Skills: {label}", ", ".join(group.get("items", []) or []))


def _note_chunks(path: Path) -> list[Chunk]:
    """One chunk per `## ` section; text before the first one is its own chunk."""
    raw = path.read_text(encoding="utf-8")
    heading = re.search(r"^# (.+)$", raw, re.MULTILINE)
    doc_title = heading.group(1).strip() if heading else path.stem.replace("-", " ").title()
    body = raw[heading.end() :] if heading else raw

    chunks = []
    for n, section in enumerate(re.split(r"^## ", body, flags=re.MULTILINE)):
        section = section.strip()
        if not section:
            continue
        if n == 0:
            title, text = doc_title, section
        else:
            sub, _, text = section.partition("\n")
            title, text = f"{doc_title}: {sub.strip()}", text.strip()
        if text:
            chunks.append(Chunk(f"note:{path.stem}:{n}", title, text))
    return chunks


def build_chunks() -> list[Chunk]:
    data = load_content()
    profile = data["profile"]
    chunks = [
        *_profile_chunks(profile),
        _contact_chunk(profile, data["socials"]),
        *(_job_chunk(job) for job in data["experience"]),
        *(c for project in data["projects"] for c in _project_chunks(project)),
        *(_skill_chunk(group) for group in data["skillGroups"]),
    ]
    if NOTES_DIR.is_dir():
        for path in sorted(NOTES_DIR.glob("*.md")):
            if path.name.lower() != "readme.md":
                chunks.extend(_note_chunks(path))
    return [c for c in chunks if c.text.strip()]


# --- retrieval --------------------------------------------------------------

_WORD = re.compile(r"\w+", re.UNICODE)
_STOP = frozenset(
    "a an and are as at be by can could did do does for from has have he his how i in is it "
    "me my of on or that the this to was what when where which who why will with you your "
    "about tell sahil him".split()
)


def _terms(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 1 and w not in _STOP}


class KnowledgeIndex:
    def __init__(self, chunks: list[Chunk], vectors: np.ndarray | None, client: Any = None):
        self.chunks = chunks
        # Rows L2-normalised once here so a query is a single matrix-vector dot.
        if vectors is not None:
            vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        self.vectors = vectors
        self._client = client
        self._query_cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._chunk_terms = [_terms(f"{c.title} {c.text}") for c in chunks]

    async def _embed_query(self, query: str) -> np.ndarray | None:
        key = query.strip().lower()
        if key in self._query_cache:
            self._query_cache.move_to_end(key)
            return self._query_cache[key]
        if self._client is None or self.vectors is None:
            return None
        try:
            resp = await asyncio.wait_for(
                # No SDK retries: a retry can't land inside the budget anyway.
                self._client.with_options(max_retries=0).embeddings.create(model=EMBED_MODEL, input=query),
                timeout=QUERY_TIMEOUT_S,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Query embedding failed, using keyword fallback: %s", exc)
            return None
        vec = np.asarray(resp.data[0].embedding, dtype=np.float32)
        vec /= np.linalg.norm(vec)
        self._query_cache[key] = vec
        if len(self._query_cache) > 256:
            self._query_cache.popitem(last=False)
        return vec

    def _keyword_search(self, query: str, k: int) -> list[Chunk]:
        q = _terms(query)
        if not q:
            return []
        scored = [(len(q & terms), i) for i, terms in enumerate(self._chunk_terms)]
        scored = [s for s in scored if s[0] > 0]
        scored.sort(key=lambda s: -s[0])
        return [self.chunks[i] for _, i in scored[:k]]

    async def search(self, query: str, k: int = TOP_K) -> list[Chunk]:
        query = query.strip()
        if not query:
            return []
        vec = await self._embed_query(query)
        if vec is None:
            return self._keyword_search(query, k)
        scores = self.vectors @ vec
        order = np.argsort(-scores)[:k]
        return [self.chunks[i] for i in order if scores[i] >= MIN_SCORE]


def _read_cache() -> dict[str, list[float]]:
    try:
        cached = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        if cached.get("model") == EMBED_MODEL:
            return cached.get("vectors", {})
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Ignoring unreadable knowledge cache %s: %s", INDEX_FILE, exc)
    return {}


def _write_cache(vectors: dict[str, list[float]]) -> None:
    try:
        INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
        INDEX_FILE.write_text(json.dumps({"model": EMBED_MODEL, "vectors": vectors}), encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not write knowledge cache %s: %s", INDEX_FILE, exc)


async def build_index(client: Any = None) -> KnowledgeIndex:
    """Embed the corpus (cached by content hash) and return a ready index.

    Without credentials, or if the embedding call fails, the index still comes
    up in keyword-only mode — the agent must start either way.
    """
    chunks = build_chunks()
    if client is None and settings.openai_api_key:
        from openai import AsyncOpenAI
        from vox.llms.http_client_pool import get_shared_http_client

        # The same pooled connection the LLM uses, and that room_bot prewarms
        # at session start. A cold TLS handshake to OpenAI costs seconds on a
        # poor route; reusing the warm one is what keeps the query embedding
        # in the hundreds of milliseconds.
        client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            http_client=get_shared_http_client(base_url=None, http2=False),
        )
    if client is None:
        logger.warning("No OpenAI key: knowledge index running in keyword-only mode")
        return KnowledgeIndex(chunks, None)

    cache = _read_cache()
    missing = [c for c in chunks if c.digest not in cache]
    if missing:
        try:
            resp = await client.embeddings.create(model=EMBED_MODEL, input=[c.render() for c in missing])
        except Exception as exc:
            logger.error("Seeding the knowledge index failed, keyword-only mode: %s", exc)
            return KnowledgeIndex(chunks, None, client)
        for chunk, item in zip(missing, resp.data):
            cache[chunk.digest] = item.embedding
    # Write only live digests, so the cache can't grow with every edit.
    live = {c.digest: cache[c.digest] for c in chunks}
    if missing or len(live) != len(cache):
        _write_cache(live)

    vectors = np.asarray([live[c.digest] for c in chunks], dtype=np.float32)
    logger.info("Knowledge index ready: %d chunks (%d newly embedded)", len(chunks), len(missing))
    return KnowledgeIndex(chunks, vectors, client)


# --- turn-time glue ---------------------------------------------------------

_index: KnowledgeIndex | None = None
_index_lock = asyncio.Lock()


async def get_index() -> KnowledgeIndex:
    global _index
    async with _index_lock:
        if _index is None:
            _index = await build_index()
        return _index


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # multi-part content
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def retrieval_query(messages: list[dict[str, Any]]) -> str:
    """The last visitor turn, plus the one before it when the last is short.

    "Tell me more about that" retrieves nothing on its own; carrying the
    previous question along is what lets a follow-up land on the same topic.
    """
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    users = [u.strip() for u in users if u.strip()]
    if not users:
        return ""
    last = users[-1]
    if len(last.split()) < 8 and len(users) > 1:
        return f"{users[-2]}\n{last}"
    return last


def format_context(chunks: list[Chunk]) -> str:
    if not chunks:
        return ""
    passages = "\n\n".join(c.render() for c in chunks)
    return (
        "### RETRIEVED NOTES for this question (part of your source of truth)\n\n"
        f"{passages}\n\n"
        "Answer from these notes and the fact sheet. If neither covers what was "
        "asked, say you don't have that detail."
    )


async def context_for(messages: list[dict[str, Any]]) -> str:
    """Vox `context_provider`: the passages to show the model for this turn."""
    query = retrieval_query(messages)
    if not query:
        return ""
    index = await get_index()
    return format_context(await index.search(query))


if __name__ == "__main__":
    # Seed (or refresh) the cache and try a query:
    #   python -m app.knowledge "what did he build with vLLM?"
    import sys

    logging.basicConfig(level=logging.INFO)

    async def _main() -> None:
        index = await get_index()
        for query in sys.argv[1:]:
            print(f"\n>>> {query}")
            for chunk in await index.search(query):
                print(f"  - {chunk.title}")

    asyncio.run(_main())
