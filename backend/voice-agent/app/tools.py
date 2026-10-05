"""Page-control tools: the agent drives the portfolio while it talks.

Each tool is fulfilled by the visitor's browser over the conversation's own
socket. Vox's tool mechanism (`api_tools`) normally makes an HTTP request; a
`client-rpc://` url tells `trigger_api` to ask the connected client instead and
wait for its answer (see `vox/helpers/function_calling_helpers.py`).

These actions have no server-side effect whatsoever — they scroll a page and open
a panel. Routing them over HTTP previously meant this service calling itself on
loopback just to reach a socket it already held, which in turn required
`VOX_TOOL_URL_HOST_ALLOWLIST` to disable Vox's SSRF guard for the request. None
of that is needed now.

The browser both validates the arguments and supplies the sentence the LLM hears
back, because it is the side that knows what is actually on the page. Tool
arguments reach the payload through `{"$var": "<arg>"}` markers in `param` (see
`prepare_api_request`), so templates below use that form.
"""

from __future__ import annotations

from typing import Any

SECTIONS = ("about", "experience", "skills", "projects", "contact")

# OpenAI strict mode requires every property listed in `required` and
# additionalProperties disabled, so the no-argument tools declare empty schemas.
_NO_ARGS: dict[str, Any] = {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": False,
}


def _tool(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
            "strict": True,
        },
    }


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    _tool(
        "show_section",
        "Scroll the visitor's view to a section of Sahil's portfolio. Call this "
        "when you start talking about that topic, so they see it while you "
        "speak. For example, call it with 'projects' when you begin describing "
        "his projects.",
        {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "enum": list(SECTIONS),
                    "description": "Which section of the page to scroll to.",
                }
            },
            "required": ["section"],
            "additionalProperties": False,
        },
    ),
    _tool(
        "open_terminal",
        "Open the interactive terminal on Sahil's site, where the visitor can "
        "explore his portfolio with typed commands. Call this only if they ask "
        "about the terminal or want to explore it themselves.",
        _NO_ARGS,
    ),
    _tool(
        "download_resume",
        "Start downloading Sahil's resume PDF for the visitor. Call this when "
        "they ask for his resume or CV.",
        _NO_ARGS,
    ),
    _tool(
        "open_contact_form",
        "Open the contact form so the visitor can send Sahil a message. Call "
        "this when they want to get in touch, hire him, or follow up.",
        _NO_ARGS,
    ),
]

# `param` templates keyed by tool name. Absent means "no payload".
_PARAM_TEMPLATES: dict[str, dict[str, Any]] = {
    "show_section": {"section": {"$var": "section"}},
}

TOOL_NAMES = tuple(t["function"]["name"] for t in TOOL_DEFINITIONS)

# The scheme trigger_api dispatches on. Kept in sync with
# vox.helpers.function_calling_helpers.CLIENT_RPC_SCHEME.
RPC_SCHEME = "client-rpc://"


def build_api_tools() -> dict[str, Any]:
    """Vox `api_tools` config.

    Unlike the HTTP version this carries no session id and no bearer token: the
    call goes down one conversation's own socket, so there is no other session
    for a hallucinated argument to reach.
    """
    tools_params: dict[str, Any] = {
        definition["function"]["name"]: {
            "url": f"{RPC_SCHEME}{definition['function']['name']}",
            "method": "POST",
            "param": _PARAM_TEMPLATES.get(definition["function"]["name"]),
            # Run silently. These land in the browser in milliseconds, so the
            # default "just give me a moment" filler would interrupt the very
            # sentence the action is illustrating.
            "pre_call_message": "",
        }
        for definition in TOOL_DEFINITIONS
    }

    return {"tools": TOOL_DEFINITIONS, "tools_params": tools_params}
