"""Speech transcribers and language identification.

Attributes resolve lazily (PEP 562) so importing this package does not drag in
every provider's third-party dependency. Upstream imported all of them eagerly;
the portfolio voice agent only uses a couple, and the unused ones pulled in
~20 packages it never calls. Public names are unchanged.

Original kept alongside as ``__init__.py.orig``.
"""

from importlib import import_module

_LAZY = {
    "BaseTranscriber": "vox.transcriber.base_transcriber",
    "DeepgramTranscriber": "vox.transcriber.deepgram_transcriber",
    "AzureTranscriber": "vox.transcriber.azure_transcriber",
    "SarvamTranscriber": "vox.transcriber.sarvam_transcriber",
    "AssemblyAITranscriber": "vox.transcriber.assemblyai_transcriber",
    "GoogleTranscriber": "vox.transcriber.google_transcriber",
    "PixaTranscriber": "vox.transcriber.pixa_transcriber",
    "GladiaTranscriber": "vox.transcriber.gladia_transcriber",
    "ElevenLabsTranscriber": "vox.transcriber.elevenlabs_transcriber",
    "SmallestTranscriber": "vox.transcriber.smallest_transcriber",
    "OpenAITranscriber": "vox.transcriber.openai_transcriber",
    "SonioxTranscriber": "vox.transcriber.soniox_transcriber",
    "TranscriberPool": "vox.transcriber.transcriber_pool",
    "LIDProvider": "vox.lid",
    "SarvamLID": "vox.lid",
    "SonioxLID": "vox.lid",
}

__all__ = sorted(_LAZY)


def __getattr__(name):
    module_path = _LAZY.get(name)
    if module_path is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module_path), name)
    globals()[name] = value  # cache; __getattr__ only fires on a miss
    return value


def __dir__():
    return list(__all__)
