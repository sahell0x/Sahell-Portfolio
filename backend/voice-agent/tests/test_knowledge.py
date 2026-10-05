"""The retrieval layer: what gets indexed, what a turn retrieves, and that
nothing about it can stop a reply.

Embeddings come from a fake client that hashes words into a vector, so these
run offline and deterministically while still exercising the cosine path.
"""

import asyncio
import json
import zlib
from types import SimpleNamespace

import numpy as np
import pytest

from app import knowledge
from app.content import load_content
from app.knowledge import Chunk, KnowledgeIndex, build_chunks, build_index, retrieval_query

DIM = 256


def _vec(text: str) -> list[float]:
    v = np.zeros(DIM, dtype=np.float32)
    for word in knowledge._terms(text):
        v[zlib.crc32(word.encode()) % DIM] += 1.0
    v[0] += 1e-3  # never all-zero
    return v.tolist()


class FakeEmbeddings:
    def __init__(self):
        self.calls: list[list[str]] = []

    async def create(self, model, input):
        batch = [input] if isinstance(input, str) else list(input)
        self.calls.append(batch)
        return SimpleNamespace(data=[SimpleNamespace(embedding=_vec(t)) for t in batch])


class FakeClient:
    def __init__(self):
        self.embeddings = FakeEmbeddings()

    def with_options(self, **_):
        return self


@pytest.fixture
def cache_file(tmp_path, monkeypatch):
    path = tmp_path / "knowledge_index.json"
    monkeypatch.setattr(knowledge, "INDEX_FILE", path)
    return path


@pytest.fixture
def notes_dir(tmp_path, monkeypatch):
    path = tmp_path / "notes"
    path.mkdir()
    monkeypatch.setattr(knowledge, "NOTES_DIR", path)
    return path


class TestCorpus:
    def test_covers_every_job_project_and_skill_group(self):
        text = "\n".join(c.render() for c in build_chunks())
        data = load_content()
        for job in data["experience"]:
            assert job["company"] in text
            for highlight in job.get("highlights", []):
                assert highlight in text
        for project in data["projects"]:
            assert project["name"] in text
            for feature in project.get("features", []):
                assert feature["detail"] in text
        for group in data["skillGroups"]:
            assert group["items"][0] in text
        assert data["profile"]["email"] in text

    def test_never_indexes_the_placeholder_demo_link(self):
        assert not any("example.com" in c.text for c in build_chunks())

    def test_chunk_ids_are_unique(self):
        ids = [c.id for c in build_chunks()]
        assert len(ids) == len(set(ids))

    def test_markdown_notes_split_per_section(self, notes_dir):
        (notes_dir / "voice.md").write_text(
            "# Voice platform\n\nIntro line.\n\n## Latency\nUnder a second.\n\n## Empty\n\n"
        )
        (notes_dir / "README.md").write_text("# Not indexed\n\n## Section\ntext\n")
        notes = [c for c in build_chunks() if c.id.startswith("note:")]
        assert [(c.title, c.text) for c in notes] == [
            ("Voice platform", "Intro line."),
            ("Voice platform: Latency", "Under a second."),
        ]


class TestSeeding:
    async def test_embeds_everything_once_then_only_changes(self, cache_file, notes_dir):
        client = FakeClient()
        await build_index(client)
        assert len(client.embeddings.calls) == 1
        seeded = len(client.embeddings.calls[0])
        assert seeded == len(build_chunks())

        await build_index(client)
        assert len(client.embeddings.calls) == 1  # all cached

        (notes_dir / "extra.md").write_text("# Extra\n\nA brand new fact.\n")
        await build_index(client)
        assert client.embeddings.calls[-1] == ["[Extra]\nA brand new fact."]

    async def test_cache_drops_stale_entries(self, cache_file, notes_dir):
        note = notes_dir / "n.md"
        note.write_text("# N\n\nfirst version\n")
        await build_index(FakeClient())
        note.write_text("# N\n\nsecond version\n")
        await build_index(FakeClient())
        cached = json.loads(cache_file.read_text())["vectors"]
        assert set(cached) == {c.digest for c in build_chunks()}

    async def test_failed_seed_still_yields_a_keyword_index(self, cache_file):
        class Broken(FakeClient):
            def __init__(self):
                async def boom(**_):
                    raise RuntimeError("down")

                self.embeddings = SimpleNamespace(create=boom)

        index = await build_index(Broken())
        assert index.vectors is None
        assert any("HootPR" in c.title for c in await index.search("HootPR"))


class TestSearch:
    def _index(self, client=None):
        chunks = [
            Chunk("a", "Education", "B.E. Electronics, CGPA 7.34"),
            Chunk("b", "Project: HootPR", "AI code reviewer sandbox pull requests"),
            Chunk("c", "Contact", "email phone github"),
        ]
        vectors = np.asarray([_vec(c.render()) for c in chunks], dtype=np.float32)
        return KnowledgeIndex(chunks, vectors, client or FakeClient())

    async def test_ranks_the_matching_chunk_first(self):
        hits = await self._index().search("what was his CGPA in electronics?")
        assert hits[0].id == "a"

    async def test_repeated_query_skips_the_embedding_call(self):
        client = FakeClient()
        index = self._index(client)
        await index.search("HootPR sandbox")
        await index.search("  hootpr SANDBOX ")
        assert len(client.embeddings.calls) == 1

    async def test_slow_embedding_falls_back_to_keywords(self, monkeypatch):
        monkeypatch.setattr(knowledge, "QUERY_TIMEOUT_S", 0.01)

        class Slow(FakeClient):
            def __init__(self):
                async def slow(**_):
                    await asyncio.sleep(1)

                self.embeddings = SimpleNamespace(create=slow)

        hits = await self._index(Slow()).search("HootPR pull requests")
        assert hits[0].id == "b"

    async def test_empty_query_retrieves_nothing(self):
        assert await self._index().search("   ") == []


class TestTurnQuery:
    def test_uses_the_latest_question(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "What did he build at Purple Sky Infotech for the voice platform?"},
        ]
        assert retrieval_query(msgs) == msgs[1]["content"]

    def test_short_follow_up_carries_the_previous_question(self):
        msgs = [
            {"role": "user", "content": "Tell me about HootPR"},
            {"role": "assistant", "content": "It reviews PRs."},
            {"role": "user", "content": "how does that work?"},
        ]
        assert retrieval_query(msgs) == "Tell me about HootPR\nhow does that work?"

    def test_no_user_turn_means_no_query(self):
        assert retrieval_query([{"role": "system", "content": "x"}]) == ""

    async def test_context_for_returns_labelled_passages(self):
        context = await knowledge.context_for([{"role": "user", "content": "HootPR"}])
        assert context.startswith("### RETRIEVED NOTES")
        assert "HootPR" in context


class TestEngineHook:
    """vox's TaskManager puts the context in this turn's messages only."""

    def _manager(self, provider):
        from vox.agent_manager.task_manager import TaskManager

        manager = object.__new__(TaskManager)
        manager.kwargs = {"context_provider": provider}
        return manager

    async def test_inserts_before_the_latest_user_turn(self):
        async def provider(_messages):
            return "CTX"

        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "q1"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "q2"},
        ]
        out = await self._manager(provider)._inject_retrieved_context(msgs)
        assert [m["content"] for m in out] == ["sys", "q1", "a1", "CTX", "q2"]
        assert len(msgs) == 4  # the caller's list is untouched

    async def test_a_failing_provider_never_blocks_the_turn(self):
        async def provider(_messages):
            raise RuntimeError("boom")

        msgs = [{"role": "user", "content": "q"}]
        assert await self._manager(provider)._inject_retrieved_context(msgs) == msgs
