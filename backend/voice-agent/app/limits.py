"""In-memory abuse and cost controls.

Single instance, so plain dicts are enough — no Redis. Counters reset on
restart, which is acceptable for a portfolio site: the worst case is a visitor
getting one extra session after a deploy.

Everything here is monotonic-clock based and takes an explicit `now` so the
tests don't have to sleep.

## Three layers, innermost first

**Device** — a browser profile, identified by a value the client stores and
echoes back. One live session per device is what stops five tabs each holding a
call, and a cooldown is what stops the button being mashed. A device id is
*spoofable*: clearing site data mints a new one. That is understood and
accepted, because it is the layer that produces a helpful message ("you already
have this open in another tab"), not the layer that enforces the ceiling.

**IP** — the real cap: how many sessions one network may hold at once, and how
many it may start per hour and per day. Clearing site data walks straight into
this, which is why the device layer being weak costs nothing.

**Global** — an optional total-concurrency cap and an optional daily ceiling.
Both are **off by default**, and that is a deliberate choice rather than an
oversight. The device and IP layers refuse *abuse*: the same browser opening a
second tab, the same network holding too many at once. A global cap is different
in kind — it refuses a stranger who has done nothing wrong, purely because other
strangers arrived first. On a portfolio, being read by many people at once is
the goal, so the only limit whose cost falls on the intended audience stays off
until someone decides otherwise. `MAX_CONCURRENT_SESSIONS` and
`DAILY_SESSION_CEILING` are the levers if a bill ever surprises.

Device-scoped rules apply only when the caller supplies a device id. A client
that sends none is judged exactly as before, so nothing is locked out by a
check it cannot satisfy.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field

HOUR = 3600.0
DAY = 86400.0


class LimitReason:
    """Stable codes the frontend switches on to pick a message."""

    IP_HOURLY = "ip_hourly"
    IP_DAILY = "ip_daily"
    CONCURRENCY = "concurrency"
    DAILY_CEILING = "daily_ceiling"
    TEXT_HOURLY = "text_hourly"
    # Device-scoped: only ever returned when the caller supplied a device id.
    DEVICE_ACTIVE = "device_active"
    DEVICE_HOURLY = "device_hourly"
    DEVICE_DAILY = "device_daily"
    COOLDOWN = "cooldown"
    IP_CONCURRENCY = "ip_concurrency"


@dataclass
class LimitDecision:
    allowed: bool
    reason: str | None = None
    retry_after: int = 0
    message: str = ""


@dataclass
class Quota:
    """What a visitor has left, for showing *before* they hit a wall.

    `remaining_hour` and `remaining_day` are the smaller of the device's and the
    network's budgets, because reporting the device figure alone would promise
    sessions the IP cap will refuse.
    """

    remaining_hour: int
    remaining_day: int
    #: The full daily allowance, so the page can warn "1 of 3" before spending one.
    per_day: int
    #: Seconds until the hourly budget frees a slot; 0 when one is free now.
    resets_in: int
    #: A live session is already open on this device — usually another tab.
    active_elsewhere: bool
    #: Seconds left before this device may start again.
    cooldown_remaining: int
    #: Whether a session started right now would be granted.
    allowed: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "remaining_hour": self.remaining_hour,
            "remaining_day": self.remaining_day,
            "per_day": self.per_day,
            "resets_in": self.resets_in,
            "active_elsewhere": self.active_elsewhere,
            "cooldown_remaining": self.cooldown_remaining,
            "allowed": self.allowed,
        }


@dataclass
class _Active:
    """One live session, kept so it can be attributed and expired."""

    ip: str
    device_id: str | None
    started: float


@dataclass
class _Window:
    """Timestamps inside a rolling window."""

    span: float
    events: deque[float] = field(default_factory=deque)

    def prune(self, now: float) -> None:
        cutoff = now - self.span
        while self.events and self.events[0] <= cutoff:
            self.events.popleft()

    def count(self, now: float) -> int:
        self.prune(now)
        return len(self.events)

    def add(self, now: float) -> None:
        self.events.append(now)

    def retry_after(self, now: float) -> int:
        self.prune(now)
        if not self.events:
            return 0
        return max(1, int(self.events[0] + self.span - now) + 1)


class RateLimiter:
    """Device, IP and global limits over one process's memory."""

    def __init__(
        self,
        *,
        per_ip_hour: int,
        per_ip_day: int,
        max_concurrent: int = 0,
        daily_ceiling: int = 0,
        text_per_ip_hour: int = 30,
        per_device_hour: int = 3,
        per_device_day: int = 10,
        max_per_ip: int = 2,
        cooldown_seconds: float = 30.0,
        session_ttl: float = 900.0,
    ) -> None:
        self.per_ip_hour = per_ip_hour
        self.per_ip_day = per_ip_day
        self.max_concurrent = max_concurrent
        self.daily_ceiling = daily_ceiling
        self.text_per_ip_hour = text_per_ip_hour
        self.per_device_hour = per_device_hour
        self.per_device_day = per_device_day
        self.max_per_ip = max_per_ip
        self.cooldown_seconds = cooldown_seconds
        # A session whose end callback never fires — closed laptop, killed tab,
        # dropped room — would otherwise hold its device and concurrency slot
        # forever. Nothing lives longer than this.
        self.session_ttl = session_ttl

        self._lock = threading.Lock()
        self._hourly: dict[str, _Window] = {}
        self._daily: dict[str, _Window] = {}
        self._text: dict[str, _Window] = {}
        self._device_hourly: dict[str, _Window] = {}
        self._device_daily: dict[str, _Window] = {}
        self._global_daily = _Window(DAY)
        self._active: dict[str, _Active] = {}
        # Device -> when its most recent session began, for the cooldown.
        self._last_start: dict[str, float] = {}

    # ---- helpers ---------------------------------------------------------

    def _window(self, table: dict[str, _Window], key: str, span: float) -> _Window:
        window = table.get(key)
        if window is None:
            window = _Window(span)
            table[key] = window
        return window

    def _sweep(self, now: float) -> None:
        """Drop empty windows so a scan of many IPs doesn't leak memory."""
        for table in (self._hourly, self._daily, self._text, self._device_hourly, self._device_daily):
            for key in [k for k, w in table.items() if w.count(now) == 0]:
                del table[key]
        for device, started in list(self._last_start.items()):
            if now - started > max(self.cooldown_seconds, HOUR):
                del self._last_start[device]

    def _reap(self, now: float) -> None:
        """Expire sessions that outlived any plausible call. Caller holds the lock."""
        for session_id, active in list(self._active.items()):
            if now - active.started > self.session_ttl:
                del self._active[session_id]

    def _ip_active(self, ip: str) -> int:
        return sum(1 for a in self._active.values() if a.ip == ip)

    def _device_is_active(self, device_id: str) -> bool:
        return any(a.device_id == device_id for a in self._active.values())

    def _cooldown_left(self, device_id: str, now: float) -> int:
        started = self._last_start.get(device_id)
        if started is None:
            return 0
        remaining = self.cooldown_seconds - (now - started)
        return max(0, int(remaining) + 1) if remaining > 0 else 0

    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._active)

    # ---- voice sessions --------------------------------------------------

    def _check_session_locked(self, ip: str, device_id: str | None, now: float) -> LimitDecision:
        """The decision itself. Caller holds the lock and has already reaped.

        Order is by what the visitor can *act on*: their own open tab first
        (close it and you're through), then whether the service has room at all,
        then their personal budgets. A message that names the wrong obstacle is
        worse than no message.

        Within the budgets the day is tested before the hour, which looks
        backwards — the shorter wait is usually the kinder one to name. It isn't
        here: an exhausted day makes the hourly message a lie, since the hour it
        promises will be refused again. The reverse never happens, so the coarse
        window has to be asked first.
        """
        if device_id is not None and self._device_is_active(device_id):
            return LimitDecision(
                False,
                LimitReason.DEVICE_ACTIVE,
                # No countdown: closing the other tab frees this instantly, and
                # a timer would tell the visitor to wait for nothing.
                retry_after=0,
                message=(
                    "You already have a conversation open in another tab. "
                    "Close it and you can start again here."
                ),
            )

        if self.max_concurrent and len(self._active) >= self.max_concurrent:
            return LimitDecision(
                False,
                LimitReason.CONCURRENCY,
                retry_after=60,
                message="A few people are talking to the assistant right now.",
            )

        if self.daily_ceiling and self._global_daily.count(now) >= self.daily_ceiling:
            return LimitDecision(
                False,
                LimitReason.DAILY_CEILING,
                retry_after=self._global_daily.retry_after(now),
                message="The voice demo has hit its limit for today.",
            )

        if self.max_per_ip and self._ip_active(ip) >= self.max_per_ip:
            return LimitDecision(
                False,
                LimitReason.IP_CONCURRENCY,
                retry_after=60,
                message="There are already voice sessions running on this network.",
            )

        if device_id is not None:
            cooldown = self._cooldown_left(device_id, now)
            if cooldown:
                return LimitDecision(
                    False,
                    LimitReason.COOLDOWN,
                    retry_after=cooldown,
                    message="Just a moment before you start another call.",
                )

            # The day is tested before the hour, against the general rule of
            # naming the shortest wait first. When both windows are full the
            # hourly message is simply false: it promises a slot in an hour
            # that the daily cap will refuse again. The hourly branch below
            # still fires on its own, with its own shorter wait, whenever the
            # day has room left.
            device_daily = self._window(self._device_daily, device_id, DAY)
            if device_daily.count(now) >= self.per_device_day:
                return LimitDecision(
                    False,
                    LimitReason.DEVICE_DAILY,
                    retry_after=device_daily.retry_after(now),
                    message="You've used your voice sessions for today.",
                )

            device_hourly = self._window(self._device_hourly, device_id, HOUR)
            if device_hourly.count(now) >= self.per_device_hour:
                return LimitDecision(
                    False,
                    LimitReason.DEVICE_HOURLY,
                    retry_after=device_hourly.retry_after(now),
                    message="You've used your voice sessions for this hour.",
                )

        daily = self._window(self._daily, ip, DAY)
        if daily.count(now) >= self.per_ip_day:
            return LimitDecision(
                False,
                LimitReason.IP_DAILY,
                retry_after=daily.retry_after(now),
                message="You've used your voice sessions for today.",
            )

        hourly = self._window(self._hourly, ip, HOUR)
        if hourly.count(now) >= self.per_ip_hour:
            return LimitDecision(
                False,
                LimitReason.IP_HOURLY,
                retry_after=hourly.retry_after(now),
                message="You've used your voice sessions for this hour.",
            )

        return LimitDecision(True)

    def check_session(
        self,
        ip: str,
        device_id: str | None = None,
        now: float | None = None,
    ) -> LimitDecision:
        """Test whether this caller may start a voice session. Does not reserve."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._reap(now)
            return self._check_session_locked(ip, device_id, now)

    def start_session(
        self,
        ip: str,
        session_id: str,
        device_id: str | None = None,
        now: float | None = None,
    ) -> None:
        """Record a granted session. Call only after `check_session` passes."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._reap(now)
            self._window(self._hourly, ip, HOUR).add(now)
            self._window(self._daily, ip, DAY).add(now)
            self._global_daily.add(now)
            if device_id is not None:
                self._window(self._device_hourly, device_id, HOUR).add(now)
                self._window(self._device_daily, device_id, DAY).add(now)
                # Measured from the start, not the end: otherwise a long call
                # earns a long wait, which punishes the engaged visitor most.
                self._last_start[device_id] = now
            self._active[session_id] = _Active(ip=ip, device_id=device_id, started=now)

    def end_session(self, session_id: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            self._active.pop(session_id, None)
            self._reap(now)
            self._sweep(now)

    def is_owned_by(self, session_id: str, device_id: str | None) -> bool:
        """Whether `device_id` started this live session.

        Guards the early-hangup endpoint: a session id is unguessable, but
        ownership is cheap to verify and makes the endpoint safe by construction
        rather than by entropy.
        """
        with self._lock:
            active = self._active.get(session_id)
            return active is not None and active.device_id == device_id

    def quota(self, ip: str, device_id: str, now: float | None = None) -> Quota:
        """What this visitor has left, whether or not they are being refused."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._reap(now)

            device_hour_used = self._window(self._device_hourly, device_id, HOUR).count(now)
            device_day_used = self._window(self._device_daily, device_id, DAY).count(now)
            ip_hour_used = self._window(self._hourly, ip, HOUR).count(now)
            ip_day_used = self._window(self._daily, ip, DAY).count(now)

            remaining_hour = max(
                0,
                min(self.per_device_hour - device_hour_used, self.per_ip_hour - ip_hour_used),
            )
            remaining_day = max(
                0,
                min(self.per_device_day - device_day_used, self.per_ip_day - ip_day_used),
            )

            resets_in = 0
            if remaining_hour == 0:
                resets_in = max(
                    self._window(self._device_hourly, device_id, HOUR).retry_after(now),
                    self._window(self._hourly, ip, HOUR).retry_after(now),
                )

            decision = self._check_session_locked(ip, device_id, now)

            return Quota(
                remaining_hour=remaining_hour,
                remaining_day=remaining_day,
                # What one visitor gets, which is the tighter of the two layers.
                per_day=min(self.per_device_day, self.per_ip_day),
                resets_in=resets_in,
                active_elsewhere=self._device_is_active(device_id),
                cooldown_remaining=self._cooldown_left(device_id, now),
                allowed=decision.allowed,
            )

    # ---- text fallback ---------------------------------------------------

    def check_text(self, ip: str, now: float | None = None) -> LimitDecision:
        now = time.monotonic() if now is None else now
        with self._lock:
            window = self._window(self._text, ip, HOUR)
            if window.count(now) >= self.text_per_ip_hour:
                return LimitDecision(
                    False,
                    LimitReason.TEXT_HOURLY,
                    retry_after=window.retry_after(now),
                    message="You've sent a lot of messages this hour. Try again shortly.",
                )
            window.add(now)
            return LimitDecision(True)


def client_ip(headers: dict[str, str], fallback: str, trust_proxy: bool) -> str:
    """Resolve the caller's IP, honouring nginx's X-Forwarded-For when trusted.

    Header lookup is case-insensitive because ASGI servers don't normalise for us.
    """
    if trust_proxy:
        lowered = {k.lower(): v for k, v in headers.items()}
        forwarded = lowered.get("x-forwarded-for")
        if forwarded:
            # Left-most entry is the original client; the rest are proxies.
            first = forwarded.split(",")[0].strip()
            if first:
                return first
        real_ip = lowered.get("x-real-ip")
        if real_ip and real_ip.strip():
            return real_ip.strip()
    return fallback
