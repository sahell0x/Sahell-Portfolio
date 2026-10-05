import os
import sys
from pathlib import Path

# Import the app package from the repo without installing it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Deterministic settings for tests, applied before app.config is imported.
os.environ.setdefault("SARVAM_API_KEY", "test-sarvam")
os.environ.setdefault("OPENAI_API_KEY", "test-openai")
os.environ.setdefault("SESSION_SECONDS", "300")
os.environ.setdefault("TTS_SAMPLE_RATE", "22050")
os.environ.setdefault("STT_SAMPLE_RATE", "16000")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _offline_knowledge_index(monkeypatch):
    """Keep app startup and /chat off the network: a keyword-only index.

    tests/test_knowledge.py builds its own indexes with a fake embedder.
    """
    from app import knowledge

    monkeypatch.setattr(knowledge, "_index", knowledge.KnowledgeIndex(knowledge.build_chunks(), None))
