"""Provider registries, resolved lazily.

Upstream this module imports every provider eagerly, which pulls the entire
dependency tree — Azure Speech, Google Cloud Speech, boto/Polly, Twilio, Plivo,
litellm — into any process that so much as imports ``vox``. The portfolio
voice agent uses Sarvam, OpenAI and the default web handlers only, so eager
imports meant installing (and paying RAM for) roughly twenty packages that are
never called.

The registries below therefore map a provider name to a ``"module:attribute"``
string and import it on first lookup. Behaviour is unchanged for callers:
``.keys()``, ``in``, iteration and ``len()`` work without importing anything,
and ``registry[key]`` / ``registry.get(key)`` return the same classes as before.

A provider whose dependencies are absent raises ``ImportError`` naming the
provider when it is looked up, rather than failing at import time for everyone.

The original file is kept alongside as ``providers.py.orig``.
"""

from collections.abc import Mapping
from importlib import import_module

from .enums import TelephonyProvider, SynthesizerProvider, TranscriberProvider, LLMProvider


class _LazyRegistry(Mapping):
    """Maps provider name -> class, importing the class on first access."""

    __slots__ = ("_targets", "_cache", "_label")

    def __init__(self, label, targets):
        self._label = label
        self._targets = dict(targets)
        self._cache = {}

    def _resolve(self, key):
        if key in self._cache:
            return self._cache[key]

        target = self._targets[key]
        module_name, _, attribute = target.partition(":")
        try:
            module = import_module(module_name, package=__package__)
        except ImportError as exc:
            raise ImportError(
                f"{self._label} provider {key!r} requires a dependency that is not "
                f"installed ({exc}). Install it, or choose a different provider."
            ) from exc

        resolved = getattr(module, attribute)
        self._cache[key] = resolved
        return resolved

    def __getitem__(self, key):
        return self._resolve(key)

    def get(self, key, default=None):
        if key not in self._targets:
            return default
        return self._resolve(key)

    def __contains__(self, key):
        return key in self._targets

    def __iter__(self):
        return iter(self._targets)

    def __len__(self):
        return len(self._targets)

    def __repr__(self):
        return f"<_LazyRegistry {self._label}: {sorted(self._targets)}>"


_SYNTH = ".synthesizer"
_TRANS = ".transcriber"
_IN = ".input_handlers"
_OUT = ".output_handlers"
_LLMS = ".llms"

SUPPORTED_SYNTHESIZER_MODELS = _LazyRegistry(
    "synthesizer",
    {
        SynthesizerProvider.POLLY.value: f"{_SYNTH}:PollySynthesizer",
        SynthesizerProvider.ELEVENLABS.value: f"{_SYNTH}:ElevenlabsSynthesizer",
        SynthesizerProvider.OPENAI.value: f"{_SYNTH}:OPENAISynthesizer",
        SynthesizerProvider.DEEPGRAM.value: f"{_SYNTH}:DeepgramSynthesizer",
        SynthesizerProvider.AZURETTS.value: f"{_SYNTH}:AzureSynthesizer",
        SynthesizerProvider.CARTESIA.value: f"{_SYNTH}:CartesiaSynthesizer",
        SynthesizerProvider.SMALLEST.value: f"{_SYNTH}:SmallestSynthesizer",
        SynthesizerProvider.SARVAM.value: f"{_SYNTH}:SarvamSynthesizer",
        SynthesizerProvider.RIME.value: f"{_SYNTH}:RimeSynthesizer",
        SynthesizerProvider.PIXA.value: f"{_SYNTH}:PixaSynthesizer",
    },
)

SUPPORTED_TRANSCRIBER_PROVIDERS = _LazyRegistry(
    "transcriber",
    {
        TranscriberProvider.DEEPGRAM.value: f"{_TRANS}:DeepgramTranscriber",
        TranscriberProvider.AZURE.value: f"{_TRANS}:AzureTranscriber",
        TranscriberProvider.SARVAM.value: f"{_TRANS}:SarvamTranscriber",
        TranscriberProvider.ASSEMBLY.value: f"{_TRANS}:AssemblyAITranscriber",
        TranscriberProvider.GOOGLE.value: f"{_TRANS}:GoogleTranscriber",
        TranscriberProvider.PIXA.value: f"{_TRANS}:PixaTranscriber",
        TranscriberProvider.GLADIA.value: f"{_TRANS}:GladiaTranscriber",
        TranscriberProvider.ELEVENLABS.value: f"{_TRANS}:ElevenLabsTranscriber",
        TranscriberProvider.SMALLEST.value: f"{_TRANS}:SmallestTranscriber",
        TranscriberProvider.OPENAI.value: f"{_TRANS}:OpenAITranscriber",
        TranscriberProvider.SONIOX.value: f"{_TRANS}:SonioxTranscriber",
    },
)

# Backwards compatibility
SUPPORTED_TRANSCRIBER_MODELS = _LazyRegistry(
    "transcriber-model", {"deepgram": f"{_TRANS}:DeepgramTranscriber"}
)

SUPPORTED_LLM_PROVIDERS = _LazyRegistry(
    "llm",
    {
        LLMProvider.OPENAI.value: f"{_LLMS}:OpenAiLLM",
        LLMProvider.COHERE.value: f"{_LLMS}:LiteLLM",
        LLMProvider.OLLAMA.value: f"{_LLMS}:LiteLLM",
        LLMProvider.DEEPINFRA.value: f"{_LLMS}:LiteLLM",
        LLMProvider.TOGETHER.value: f"{_LLMS}:LiteLLM",
        LLMProvider.FIREWORKS.value: f"{_LLMS}:LiteLLM",
        LLMProvider.AZURE_OPENAI.value: f"{_LLMS}:AzureLLM",
        LLMProvider.PERPLEXITY.value: f"{_LLMS}:LiteLLM",
        LLMProvider.VLLM.value: f"{_LLMS}:LiteLLM",
        LLMProvider.ANYSCALE.value: f"{_LLMS}:LiteLLM",
        LLMProvider.CUSTOM.value: f"{_LLMS}:OpenAiLLM",
        LLMProvider.OLA.value: f"{_LLMS}:OpenAiLLM",
        LLMProvider.GROQ.value: f"{_LLMS}:LiteLLM",
        LLMProvider.ANTHROPIC.value: f"{_LLMS}:LiteLLM",
        LLMProvider.DEEPSEEK.value: f"{_LLMS}:LiteLLM",
        LLMProvider.OPENROUTER.value: f"{_LLMS}:LiteLLM",
        LLMProvider.AZURE.value: f"{_LLMS}:AzureLLM",
        LLMProvider.GOOGLE.value: f"{_LLMS}:GeminiLLM",
    },
)

_INPUT_TELEPHONY = {
    TelephonyProvider.TWILIO.value: f"{_IN}:TwilioInputHandler",
    TelephonyProvider.EXOTEL.value: f"{_IN}:ExotelInputHandler",
    TelephonyProvider.PLIVO.value: f"{_IN}:PlivoInputHandler",
    TelephonyProvider.VOBIZ.value: f"{_IN}:VobizInputHandler",
    TelephonyProvider.SIP_TRUNK.value: f"{_IN}:SipTrunkInputHandler",
}

_OUTPUT_TELEPHONY = {
    TelephonyProvider.TWILIO.value: f"{_OUT}:TwilioOutputHandler",
    TelephonyProvider.EXOTEL.value: f"{_OUT}:ExotelOutputHandler",
    TelephonyProvider.PLIVO.value: f"{_OUT}:PlivoOutputHandler",
    TelephonyProvider.VOBIZ.value: f"{_OUT}:VobizOutputHandler",
    TelephonyProvider.SIP_TRUNK.value: f"{_OUT}:SipTrunkOutputHandler",
}

SUPPORTED_INPUT_HANDLERS = _LazyRegistry(
    "input-handler",
    {
        TelephonyProvider.DEFAULT.value: f"{_IN}:DefaultInputHandler",
        **_INPUT_TELEPHONY,
        TelephonyProvider.FREESWITCH.value: f"{_IN}:FreeSwitchInputHandler",
    },
)

SUPPORTED_INPUT_TELEPHONY_HANDLERS = _LazyRegistry("input-telephony", _INPUT_TELEPHONY)

SUPPORTED_OUTPUT_HANDLERS = _LazyRegistry(
    "output-handler",
    {
        TelephonyProvider.DEFAULT.value: f"{_OUT}:DefaultOutputHandler",
        **_OUTPUT_TELEPHONY,
        TelephonyProvider.FREESWITCH.value: f"{_OUT}:FreeSwitchOutputHandler",
    },
)

SUPPORTED_OUTPUT_TELEPHONY_HANDLERS = _LazyRegistry("output-telephony", _OUTPUT_TELEPHONY)
