"""Runs one Vox conversation over one browser WebSocket.

This owns the session's lifetime — claim, run, time out, tear down — and nothing
else. The audio itself never passes through here: `WebSocketTransport` holds the
socket, and Vox's own default web-call handlers read and write it directly.

That is the difference from the previous arrangement, where a `LiveKitTransport`
owned a WebRTC room and a bespoke handler pair pushed PCM onto an audio track.
The socket is the transport the engine already speaks, so the engine drives it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Callable

from .agent_config import build_agent_config
from .config import settings
from .knowledge import context_for
from .transport import WebSocketTransport

logger = logging.getLogger(__name__)


class VoiceSession:
    """One visitor's conversation. Owns the transport and the clock."""

    def __init__(
        self,
        *,
        session_id: str,
        transport: WebSocketTransport,
        on_finished: Callable[[str], None] | None = None,
    ) -> None:
        self.session_id = session_id
        self.started_at = time.monotonic()

        self._transport = transport
        self._on_finished = on_finished
        self._finished = asyncio.Event()
        self._tasks: set[asyncio.Task] = set()
        self._closing = False

    # ---- public surface --------------------------------------------------

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self.started_at

    @property
    def remaining(self) -> float:
        return max(0.0, settings.session_seconds - self.elapsed)

    async def run(self) -> None:
        try:
            self._transport.start()
            await self._run_agent()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Session %s failed", self.session_id)
        finally:
            await self._shutdown()

    async def stop(self) -> None:
        self._finished.set()

    # ---- agent -----------------------------------------------------------

    async def _run_agent(self) -> None:
        from vox.agent_manager.assistant_manager import AssistantManager

        manager = AssistantManager(
            build_agent_config(),
            # The transport stands in for the Starlette WebSocket the default
            # handlers expect; it keeps those method signatures exactly.
            ws=self._transport,
            assistant_id=settings.agent_name,
            is_web_based_call=True,
            # Vox's init handler does context_data["recipient_data"].update(...)
            # unconditionally; without a dict here it raises and the welcome
            # message is silently dropped.
            context_data={"recipient_data": {}},
            # Reaches the client-fulfilled tools, the typed-turn injector and
            # the transcript mirror via TaskManager.kwargs.
            transport=self._transport,
            # Per-turn retrieval: the prompt carries only a fact sheet, and each
            # reply gets the passages relevant to what was just asked.
            context_provider=context_for,
        )

        async def drive() -> None:
            # local=True makes Vox read the prompt from
            # agent_data/<assistant_id>/conversation_details.json.
            async for _task_id, _output in manager.run(local=True):
                pass

        agent_task = asyncio.create_task(drive())
        self._track(agent_task)
        self._track(asyncio.create_task(self._watchdog()))
        self._track(asyncio.create_task(self._prewarm_llm()))

        # The visitor closing their tab is the usual end of a call, and it
        # reaches us as a dead socket rather than as the agent finishing.
        finished = asyncio.create_task(self._finished.wait())
        disconnected = asyncio.create_task(self._transport.closed.wait())

        done, _pending = await asyncio.wait(
            {agent_task, finished, disconnected}, return_when=asyncio.FIRST_COMPLETED
        )

        finished.cancel()
        disconnected.cancel()
        if agent_task not in done:
            agent_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await agent_task

    async def _prewarm_llm(self) -> None:
        """Pay the TLS handshake to the model before the visitor's first question does.

        Measured on this deployment: a cold connection to api.openai.com costs
        6-10s and a warm one 0.7s, and `keepalive_expiry` on the shared pool is
        what decides which one a turn gets. The welcome message spends several
        seconds synthesizing regardless, so this lands inside a window the
        visitor is already spending listening rather than waiting.

        Best effort by design — the conversation must start whether or not this
        succeeds, so a failure here is a slower first turn, never a failed one.
        """
        from vox.llms.http_client_pool import get_shared_http_client

        try:
            # Same pool key openai_llm resolves for a no-base_url config, so this
            # warms the exact connection the first completion will reach for.
            client = get_shared_http_client(base_url=None, http2=False)
            await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                timeout=10.0,
            )
            logger.info("Session %s: model connection warmed", self.session_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Session %s: could not prewarm the model connection: %s", self.session_id, exc)

    async def _watchdog(self) -> None:
        """Independent enforcement of the session cap.

        Vox's `call_terminate` covers this too; duplicating it here means a
        config regression can't hand out a longer session than intended.
        """
        warn_at = min(settings.session_warn_seconds, settings.session_seconds)
        try:
            await asyncio.sleep(max(0.0, warn_at - self.elapsed))
            if not self._finished.is_set():
                await self._transport.publish_data(
                    {
                        "type": "session_warning",
                        "remaining_seconds": int(round(self.remaining)),
                    }
                )

            await asyncio.sleep(max(0.0, self.remaining))
            if not self._finished.is_set():
                logger.info("Session %s reached its time limit", self.session_id)
                await self._transport.publish_data(
                    {"type": "session_ended", "reason": "time_limit"}
                )
                # Let the closing words reach the visitor before the socket drops.
                await asyncio.sleep(0.5)
                self._finished.set()
        except asyncio.CancelledError:
            raise

    # ---- teardown --------------------------------------------------------

    def _track(self, task: asyncio.Task) -> None:
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _shutdown(self) -> None:
        if self._closing:
            return
        self._closing = True

        for task in list(self._tasks):
            task.cancel()

        await self._transport.close()

        logger.info("Session %s ended after %.0fs", self.session_id, self.elapsed)

        if self._on_finished is not None:
            with contextlib.suppress(Exception):
                self._on_finished(self.session_id)


class SessionRegistry:
    """Sessions in flight, so limits, shutdown and the socket can find them.

    A session exists in two phases. `POST /session` mints a *ticket* — the
    visitor has passed the rate limiter and holds a slot, but no socket is open
    yet. The socket then claims that ticket exactly once. Splitting it this way
    is what lets a refusal come back as a proper HTTP 429 with the visitor's
    remaining budget, instead of a socket that opens and immediately closes.
    """

    def __init__(self) -> None:
        self._tickets: dict[str, str] = {}
        self._sessions: dict[str, VoiceSession] = {}

    # ---- tickets ---------------------------------------------------------

    def reserve(self, session_id: str, token: str) -> None:
        self._tickets[session_id] = token

    def claim(self, session_id: str, token: str) -> bool:
        """Consume a ticket. False if it is unknown, spent, or the wrong token."""
        expected = self._tickets.get(session_id)
        if expected is None or not token or token != expected:
            return False
        del self._tickets[session_id]
        return True

    def is_unclaimed(self, session_id: str) -> bool:
        return session_id in self._tickets

    # ---- live sessions ---------------------------------------------------

    def get(self, session_id: str) -> VoiceSession | None:
        return self._sessions.get(session_id)

    def count(self) -> int:
        return len(self._sessions)

    def add(self, session: VoiceSession) -> None:
        self._sessions[session.session_id] = session

    def remove(self, session_id: str) -> None:
        self._tickets.pop(session_id, None)
        self._sessions.pop(session_id, None)

    async def shutdown(self) -> None:
        self._tickets.clear()
        for session in list(self._sessions.values()):
            await session.stop()
        self._sessions.clear()
