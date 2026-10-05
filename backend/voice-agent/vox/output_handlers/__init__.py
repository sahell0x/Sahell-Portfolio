"""Output handlers.

Attributes resolve lazily (PEP 562) so importing this package does not drag in
every provider's third-party dependency. Upstream imported all of them eagerly;
the portfolio voice agent only uses a couple, and the unused ones pulled in
~20 packages it never calls. Public names are unchanged.

Original kept alongside as ``__init__.py.orig``.
"""

from importlib import import_module

_LAZY = {
    "DefaultOutputHandler": "vox.output_handlers.default",
    "TwilioOutputHandler": "vox.output_handlers.telephony_providers.twilio",
    "ExotelOutputHandler": "vox.output_handlers.telephony_providers.exotel",
    "PlivoOutputHandler": "vox.output_handlers.telephony_providers.plivo",
    "VobizOutputHandler": "vox.output_handlers.telephony_providers.vobiz",
    "SipTrunkOutputHandler": "vox.output_handlers.telephony_providers.sip_trunk",
    "FreeSwitchOutputHandler": "vox.output_handlers.telephony_providers.freeswitch",
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
