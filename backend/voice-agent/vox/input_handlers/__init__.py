"""Input handlers.

Attributes resolve lazily (PEP 562) so importing this package does not drag in
every provider's third-party dependency. Upstream imported all of them eagerly;
the portfolio voice agent only uses a couple, and the unused ones pulled in
~20 packages it never calls. Public names are unchanged.

Original kept alongside as ``__init__.py.orig``.
"""

from importlib import import_module

_LAZY = {
    "DefaultInputHandler": "vox.input_handlers.default",
    "TwilioInputHandler": "vox.input_handlers.telephony_providers.twilio",
    "ExotelInputHandler": "vox.input_handlers.telephony_providers.exotel",
    "PlivoInputHandler": "vox.input_handlers.telephony_providers.plivo",
    "VobizInputHandler": "vox.input_handlers.telephony_providers.vobiz",
    "SipTrunkInputHandler": "vox.input_handlers.telephony_providers.sip_trunk",
    "FreeSwitchInputHandler": "vox.input_handlers.telephony_providers.freeswitch",
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
