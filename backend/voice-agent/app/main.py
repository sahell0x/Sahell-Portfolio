"""HTTP and WebSocket surface for the portfolio voice agent.

    POST /session          mint a session ticket, tell the page where to dial
    WS   /ws/{session_id}  the conversation itself
    POST /chat             text fallback (no mic, no rate-limit lockout)
    GET  /health

The split between `POST /session` and the socket is deliberate. Rate limiting
answers over HTTP, so a refused visitor gets a real 429 carrying their remaining
budget and a retry time — something a socket that opens and immediately closes
cannot express. The ticket the POST returns is then spent, once, to open the
socket.

Page-control tools do not pass through here. The agent invokes them on the
visitor's browser over the same socket, so there is no internal relay endpoint,
no per-session bearer token, and no reason to weaken Vox's outbound URL policy.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from .agent_config import write_agent_prompt
from .config import settings
from .content import ContentError, load_content
from .knowledge import context_for, get_index
from .limits import RateLimiter, client_ip
from .prompt import build_system_prompt
from .room_bot import SessionRegistry, VoiceSession
from .transport import WebSocketTransport

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
# Vox logs these two at INFO once per audio frame — hundreds of lines a second
# that bury every meaningful event. Lift them to WARNING; nothing here is
# actionable at INFO. Override with VOX_LOG_LEVEL if you need the firehose back.
_vox_noise_level = getattr(logging, os.getenv("VOX_LOG_LEVEL", "WARNING").upper(), logging.WARNING)
for _noisy in ("vox.input_handlers.default", "vox.synthesizer.sarvam_synthesizer"):
    logging.getLogger(_noisy).setLevel(_vox_noise_level)

# While chasing an audio fault, the engine's own INFO stream is the thing that
# hides it. `AUDIO_TRACE=1` (the default) leaves only the `AUD` channel on the
# console; `AUDIO_TRACE_QUIET=0` keeps everything else if the wider picture is
# needed. Warnings and errors are never suppressed.
from vox.helpers.audio_trace import install_quiet_mode  # noqa: E402

install_quiet_mode()
logger = logging.getLogger("voice-agent")

limiter = RateLimiter(
    per_ip_hour=settings.sessions_per_ip_hour,
    per_ip_day=settings.sessions_per_ip_day,
    max_concurrent=settings.max_concurrent_sessions,
    daily_ceiling=settings.daily_session_ceiling,
    text_per_ip_hour=settings.text_messages_per_ip_hour,
    per_device_hour=settings.sessions_per_device_hour,
    per_device_day=settings.sessions_per_device_day,
    max_per_ip=settings.max_sessions_per_ip,
    cooldown_seconds=settings.session_cooldown_seconds,
    # Nothing may hold a slot longer than a session could possibly run. The
    # watchdog ends calls at session_seconds; this is the backstop for a room
    # that dies without ever firing its callback.
    session_ttl=settings.session_seconds + 120,
)
registry = SessionRegistry()
# Expiry timers for tickets nobody has claimed yet, held so shutdown can cancel
# them instead of leaving pending tasks behind on a closing loop.
_expiry_tasks: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    missing = settings.missing_credentials()
    if missing:
        logger.warning(
            "Missing credentials: %s. /session will fail until these are set.",
            ", ".join(missing),
        )

    try:
        load_content()
        write_agent_prompt(settings.agent_name)
        logger.info("Agent prompt written for %s", settings.agent_name)
        # Seed the retrieval index now so the first visitor doesn't pay for it.
        await get_index()
    except ContentError as exc:
        logger.error("Portfolio content unavailable: %s", exc)

    yield
    for task in list(_expiry_tasks):
        task.cancel()
    await registry.shutdown()


app = FastAPI(title="Portfolio Voice Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _ip(request: Request) -> str:
    return client_ip(
        dict(request.headers),
        request.client.host if request.client else "unknown",
        settings.trust_proxy_header,
    )


# A device id is opaque to the server: it only has to be stable per browser and
# impossible to use as an injection vector. Anything else is treated as absent
# rather than rejected, so a malformed header degrades to the IP-only path.
_DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _device_id(request: Request) -> str | None:
    """The caller's browser identity, if it sent a usable one.

    The query parameter exists for `navigator.sendBeacon`, which the page uses
    to release a session as its tab closes and which cannot set headers. The
    header is preferred wherever it is available.
    """
    raw = request.headers.get("x-device-id", "").strip()
    if not _DEVICE_ID.match(raw):
        raw = (request.query_params.get("device_id") or "").strip()
    return raw if _DEVICE_ID.match(raw) else None


def _quota_key(device_id: str | None, ip: str) -> str:
    """A stable key for reporting a budget when no device id was sent.

    Falling back to the IP keeps the numbers honest for a client that can't
    store one, without letting it borrow another visitor's allowance.
    """
    return device_id if device_id is not None else f"ip:{ip}"


def _ws_origin(request: Request) -> str:
    """Where the page should open its socket, as an absolute ws(s):// origin.

    Derived from the request that asked for it so a deployment behind nginx, a
    tunnel, or plain localhost all work without configuration. `PUBLIC_WS_URL`
    overrides it for the case where the socket does not share an origin with
    the HTTP API.
    """
    if settings.public_ws_url:
        return settings.public_ws_url.rstrip("/")

    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    scheme = forwarded or request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    return f"{'wss' if scheme == 'https' else 'ws'}://{host}"


def _origin_allowed(origin: str | None) -> bool:
    """Whether a socket handshake carrying this `Origin` may proceed.

    A browser cannot read the ticket out of a cross-origin `POST /session`
    response, so this is a second lock rather than the only one — but WebSocket
    handshakes are not covered by CORS, and a same-site check costs nothing.
    A missing Origin (curl, a test client, a native client) is allowed through;
    only a header that names a site we do not serve is refused.
    """
    if not origin:
        return True
    if origin in settings.allowed_origins:
        return True
    # Tolerate a trailing slash or a port-less form of a configured origin.
    incoming = urlsplit(origin)
    return any(
        urlsplit(allowed).netloc == incoming.netloc and urlsplit(allowed).scheme == incoming.scheme
        for allowed in settings.allowed_origins
    )


# ---- health --------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "active_sessions": registry.count(),
        "missing_credentials": settings.missing_credentials(),
    }


# ---- voice session -------------------------------------------------------


@app.post("/session")
async def create_session(request: Request) -> JSONResponse:
    missing = settings.missing_credentials()
    if missing:
        return JSONResponse(
            status_code=503,
            content={
                "error": "not_configured",
                "message": "The voice assistant isn't configured yet.",
                "missing": missing,
            },
        )

    ip = _ip(request)
    device_id = _device_id(request)
    decision = limiter.check_session(ip, device_id=device_id)
    if not decision.allowed:
        return JSONResponse(
            status_code=429,
            content={
                "error": decision.reason,
                "message": decision.message,
                "retry_after": decision.retry_after,
                "text_fallback": True,
                # Sent on refusal too, so the UI can show what's left and when
                # it comes back rather than just "no".
                "quota": limiter.quota(ip, _quota_key(device_id, ip)).as_dict(),
            },
            headers={"Retry-After": str(decision.retry_after)},
        )

    session_id = uuid.uuid4().hex
    token = secrets.token_urlsafe(24)

    limiter.start_session(ip, session_id, device_id=device_id)
    registry.reserve(session_id, token)
    expiry = asyncio.create_task(_expire_unclaimed(session_id))
    _expiry_tasks.add(expiry)
    expiry.add_done_callback(_expiry_tasks.discard)

    logger.info("Session %s created for %s", session_id, ip)

    return JSONResponse(
        content={
            "session_id": session_id,
            "url": f"{_ws_origin(request)}/ws/{session_id}",
            "token": token,
            "session_seconds": settings.session_seconds,
            "warn_seconds": settings.session_warn_seconds,
            # The page has to build PCM at one rate and play it back at another,
            # and neither is guessable from the bytes. Reported rather than
            # hardcoded on both sides so a change here cannot silently detune
            # the assistant's voice.
            "audio": {
                "input_sample_rate": settings.stt_sample_rate,
                "output_sample_rate": settings.tts_sample_rate,
            },
            "quota": limiter.quota(ip, _quota_key(device_id, ip)).as_dict(),
        }
    )


async def _expire_unclaimed(session_id: str) -> None:
    """Hand a slot back if its socket never arrives.

    A tab that dies between the POST and the handshake would otherwise hold its
    session until the limiter's TTL — minutes during which the visitor is told
    they already have a conversation open.
    """
    try:
        await asyncio.sleep(settings.connect_grace_seconds)
    except asyncio.CancelledError:
        return
    if registry.is_unclaimed(session_id):
        registry.remove(session_id)
        limiter.end_session(session_id)
        logger.info("Session %s expired unclaimed", session_id)


# ---- the conversation ----------------------------------------------------


@app.websocket("/ws/{session_id}")
async def voice_socket(websocket: WebSocket, session_id: str) -> None:
    """One conversation, from handshake to hangup.

    The socket carries Vox's own web-call protocol — base64 PCM in, base64 PCM
    and `mark` acknowledgements out — plus the page-control calls and
    transcripts layered on top of it by `WebSocketTransport`.
    """
    token = websocket.query_params.get("token", "")

    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=4403)
        return

    if not registry.claim(session_id, token):
        # Unknown, already spent, or forged. All three are the same to the
        # caller, and none is worth distinguishing on the wire.
        await websocket.close(code=4401)
        return

    await websocket.accept()

    transport = WebSocketTransport(
        websocket,
        session_id=session_id,
        stt_sample_rate=settings.stt_sample_rate,
        tts_sample_rate=settings.tts_sample_rate,
    )

    def _finished(sid: str) -> None:
        registry.remove(sid)
        limiter.end_session(sid)

    session = VoiceSession(session_id=session_id, transport=transport, on_finished=_finished)
    registry.add(session)

    try:
        await session.run()
    except WebSocketDisconnect:
        logger.info("Session %s: visitor disconnected", session_id)
    except Exception:
        logger.exception("Session %s failed", session_id)
    finally:
        registry.remove(session_id)
        limiter.end_session(session_id)


@app.get("/limits")
async def limits(request: Request) -> JSONResponse:
    """What this visitor has left, before they try.

    Lets the page show "2 sessions left this hour" and disable the button with a
    reason, instead of letting someone start a call only to be refused.
    """
    ip = _ip(request)
    device_id = _device_id(request)
    quota = limiter.quota(ip, _quota_key(device_id, ip))
    return JSONResponse(
        content={
            **quota.as_dict(),
            "session_seconds": settings.session_seconds,
            "cooldown_seconds": settings.session_cooldown_seconds,
        }
    )


@app.post("/session/{session_id}/end")
async def end_session(session_id: str, request: Request) -> JSONResponse:
    """Release a session the moment its tab goes away.

    The room's own disconnect handles this eventually, but a visitor who closes
    a tab and immediately reopens the page would otherwise be told they already
    have one open. The page calls this on unload via `sendBeacon`.
    """
    device_id = _device_id(request)
    if not limiter.is_owned_by(session_id, device_id):
        # Already gone, or not this visitor's to end. Both are a no-op, and
        # neither is worth distinguishing to the caller.
        return JSONResponse(content={"ended": False})

    session = registry.get(session_id)
    if session is not None:
        await session.stop()
    registry.remove(session_id)
    limiter.end_session(session_id)
    logger.info("Session %s ended early by the client", session_id)
    return JSONResponse(content={"ended": True})


# ---- text fallback -------------------------------------------------------


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


@app.post("/chat")
async def chat(request: Request, body: ChatRequest) -> JSONResponse:
    """Same agent, same guardrails, no audio.

    Covers denied microphones and rate-limited visitors so nobody hits a dead
    end, at a fraction of the cost of a voice session.
    """
    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "not_configured", "message": "Chat isn't configured yet."},
        )

    decision = limiter.check_text(_ip(request))
    if not decision.allowed:
        return JSONResponse(
            status_code=429,
            content={
                "error": decision.reason,
                "message": decision.message,
                "retry_after": decision.retry_after,
            },
            headers={"Retry-After": str(decision.retry_after)},
        )

    message = body.message.strip()
    if not message:
        return JSONResponse(status_code=400, content={"error": "empty_message"})
    message = message[: settings.text_max_chars]

    # Keep the tail only: an unbounded history is an easy way to run up a bill.
    history = [m for m in body.history if m.content.strip()][-8:]

    messages = [{"role": "system", "content": build_system_prompt()}]
    messages.extend({"role": m.role, "content": m.content} for m in history)
    # Same retrieval the voice path does, placed just before the question.
    context = await context_for([*messages, {"role": "user", "content": message}])
    if context:
        messages.append({"role": "system", "content": context})
    messages.append({"role": "user", "content": message})

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        completion = await client.chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
        )
        reply = (completion.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("Text chat failed")
        return JSONResponse(
            status_code=502,
            content={
                "error": "upstream_error",
                "message": "I couldn't answer just then. Try again in a moment.",
            },
        )

    return JSONResponse(content={"reply": reply})


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
