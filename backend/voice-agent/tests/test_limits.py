"""Rate limiter behaviour, including window boundaries.

Every call takes an explicit `now`, so these run instantly and deterministically
rather than sleeping through real windows.
"""

from app.limits import DAY, HOUR, LimitReason, RateLimiter, client_ip


def make_limiter(**overrides):
    kwargs = dict(per_ip_hour=2, per_ip_day=5, max_concurrent=3, daily_ceiling=0)
    kwargs.update(overrides)
    return RateLimiter(**kwargs)


def test_allows_up_to_the_hourly_limit():
    limiter = make_limiter()
    for i in range(2):
        assert limiter.check_session("1.1.1.1", now=100.0).allowed
        limiter.start_session("1.1.1.1", f"s{i}", now=100.0)
        limiter.end_session(f"s{i}", now=100.0)

    decision = limiter.check_session("1.1.1.1", now=100.0)
    assert not decision.allowed
    assert decision.reason == LimitReason.IP_HOURLY


def test_hourly_window_rolls_over():
    limiter = make_limiter()
    for i in range(2):
        limiter.start_session("1.1.1.1", f"s{i}", now=100.0)
        limiter.end_session(f"s{i}", now=100.0)

    assert not limiter.check_session("1.1.1.1", now=100.0).allowed
    # Just inside the window: still blocked.
    assert not limiter.check_session("1.1.1.1", now=100.0 + HOUR - 1).allowed
    # Just past it: allowed again.
    assert limiter.check_session("1.1.1.1", now=100.0 + HOUR + 1).allowed


def test_daily_limit_outlasts_hourly_rollover():
    limiter = make_limiter(per_ip_hour=10, per_ip_day=3)
    for i in range(3):
        limiter.start_session("2.2.2.2", f"s{i}", now=100.0 + i * HOUR * 2)
        limiter.end_session(f"s{i}", now=100.0)

    decision = limiter.check_session("2.2.2.2", now=100.0 + 5 * HOUR)
    assert not decision.allowed
    assert decision.reason == LimitReason.IP_DAILY

    assert limiter.check_session("2.2.2.2", now=100.0 + DAY + 1).allowed


def test_limits_are_per_ip():
    limiter = make_limiter()
    for i in range(2):
        limiter.start_session("1.1.1.1", f"a{i}", now=100.0)
        limiter.end_session(f"a{i}", now=100.0)

    assert not limiter.check_session("1.1.1.1", now=100.0).allowed
    assert limiter.check_session("9.9.9.9", now=100.0).allowed


def test_concurrency_cap_blocks_and_recovers():
    limiter = make_limiter(per_ip_hour=99, per_ip_day=99, max_concurrent=2)
    limiter.start_session("1.1.1.1", "s1", now=100.0)
    limiter.start_session("2.2.2.2", "s2", now=100.0)

    decision = limiter.check_session("3.3.3.3", now=100.0)
    assert not decision.allowed
    assert decision.reason == LimitReason.CONCURRENCY

    limiter.end_session("s1", now=100.0)
    assert limiter.check_session("3.3.3.3", now=100.0).allowed


def test_concurrency_is_checked_before_per_ip():
    """A full server should say "server busy", not "you're rate limited"."""
    limiter = make_limiter(per_ip_hour=1, max_concurrent=1)
    limiter.start_session("1.1.1.1", "s1", now=100.0)

    decision = limiter.check_session("1.1.1.1", now=100.0)
    assert decision.reason == LimitReason.CONCURRENCY


def test_daily_ceiling_disabled_by_default():
    limiter = make_limiter(per_ip_hour=999, per_ip_day=999, max_concurrent=999)
    for i in range(50):
        limiter.start_session(f"ip{i}", f"s{i}", now=100.0)
        limiter.end_session(f"s{i}", now=100.0)

    assert limiter.check_session("new-ip", now=100.0).allowed


def test_daily_ceiling_blocks_globally_when_enabled():
    limiter = make_limiter(per_ip_hour=999, per_ip_day=999, max_concurrent=999, daily_ceiling=3)
    for i in range(3):
        limiter.start_session(f"ip{i}", f"s{i}", now=100.0)
        limiter.end_session(f"s{i}", now=100.0)

    decision = limiter.check_session("brand-new-ip", now=100.0)
    assert not decision.allowed
    assert decision.reason == LimitReason.DAILY_CEILING

    assert limiter.check_session("brand-new-ip", now=100.0 + DAY + 1).allowed


def test_check_session_does_not_reserve():
    """Checking twice must not consume quota; only start_session does."""
    limiter = make_limiter(per_ip_hour=1)
    assert limiter.check_session("1.1.1.1", now=100.0).allowed
    assert limiter.check_session("1.1.1.1", now=100.0).allowed


def test_retry_after_is_positive_when_blocked():
    limiter = make_limiter(per_ip_hour=1)
    limiter.start_session("1.1.1.1", "s1", now=100.0)
    limiter.end_session("s1", now=100.0)

    decision = limiter.check_session("1.1.1.1", now=200.0)
    assert not decision.allowed
    assert decision.retry_after > 0
    assert decision.message


def test_text_limit_consumes_on_check():
    limiter = make_limiter(text_per_ip_hour=2)
    assert limiter.check_text("1.1.1.1", now=100.0).allowed
    assert limiter.check_text("1.1.1.1", now=100.0).allowed

    decision = limiter.check_text("1.1.1.1", now=100.0)
    assert not decision.allowed
    assert decision.reason == LimitReason.TEXT_HOURLY


def test_text_and_voice_quotas_are_independent():
    limiter = make_limiter(per_ip_hour=1, text_per_ip_hour=5)
    limiter.start_session("1.1.1.1", "s1", now=100.0)
    limiter.end_session("s1", now=100.0)

    assert not limiter.check_session("1.1.1.1", now=100.0).allowed
    assert limiter.check_text("1.1.1.1", now=100.0).allowed


def test_idle_ip_windows_are_swept():
    limiter = make_limiter()
    for i in range(20):
        limiter.start_session(f"ip{i}", f"s{i}", now=100.0)
        limiter.end_session(f"s{i}", now=100.0)

    assert len(limiter._hourly) == 20
    limiter.end_session("nonexistent", now=100.0 + DAY + 1)
    assert len(limiter._hourly) == 0


class TestClientIp:
    def test_uses_forwarded_header_when_trusted(self):
        headers = {"X-Forwarded-For": "203.0.113.5, 10.0.0.1"}
        assert client_ip(headers, "10.0.0.1", trust_proxy=True) == "203.0.113.5"

    def test_header_lookup_is_case_insensitive(self):
        headers = {"x-forwarded-for": "203.0.113.9"}
        assert client_ip(headers, "10.0.0.1", trust_proxy=True) == "203.0.113.9"

    def test_ignores_header_when_untrusted(self):
        headers = {"X-Forwarded-For": "1.2.3.4"}
        assert client_ip(headers, "10.0.0.1", trust_proxy=False) == "10.0.0.1"

    def test_falls_back_to_real_ip_header(self):
        headers = {"X-Real-IP": "198.51.100.7"}
        assert client_ip(headers, "10.0.0.1", trust_proxy=True) == "198.51.100.7"

    def test_falls_back_to_socket_when_no_headers(self):
        assert client_ip({}, "10.0.0.1", trust_proxy=True) == "10.0.0.1"

    def test_blank_forwarded_header_falls_back(self):
        headers = {"X-Forwarded-For": "   "}
        assert client_ip(headers, "10.0.0.1", trust_proxy=True) == "10.0.0.1"


# ---------------------------------------------------------------------------
# Per-device limits: the multi-tab and rapid-redial defences.
#
# A device is a browser profile, identified by a value the client stores and
# echoes back. It is spoofable — clearing site data mints a new one — so it is
# deliberately the *inner* layer: it makes casual abuse (five tabs, mashing the
# button) impossible, while the per-IP and global caps remain the real ceiling.
# ---------------------------------------------------------------------------

DEVICE_A = "device-aaa"
DEVICE_B = "device-bbb"


def device_limiter(**overrides):
    kwargs = dict(
        per_ip_hour=99,
        per_ip_day=99,
        max_concurrent=99,
        per_device_hour=3,
        per_device_day=10,
        max_per_ip=2,
        cooldown_seconds=30,
    )
    kwargs.update(overrides)
    return RateLimiter(**kwargs)


class TestMultipleTabs:
    def test_a_second_tab_on_the_same_device_is_refused(self):
        limiter = device_limiter()
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0)
        assert not decision.allowed
        assert decision.reason == LimitReason.DEVICE_ACTIVE
        assert "tab" in decision.message.lower()

    def test_the_refusal_names_no_wait_because_the_fix_is_immediate(self):
        """Closing the other tab frees it now; a countdown would be a lie."""
        limiter = device_limiter()
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        assert limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0).retry_after == 0

    def test_ending_the_first_session_frees_the_device(self):
        limiter = device_limiter(cooldown_seconds=0)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=100.0)

        assert limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0).allowed

    def test_a_different_browser_on_the_same_network_is_unaffected(self):
        limiter = device_limiter()
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        assert limiter.check_session("1.1.1.1", device_id=DEVICE_B, now=100.0).allowed

    def test_a_client_that_sends_no_device_id_keeps_the_old_behaviour(self):
        """Legacy clients must not be locked out by a check they can't satisfy."""
        limiter = device_limiter()
        limiter.start_session("1.1.1.1", "s1", now=100.0)

        assert limiter.check_session("1.1.1.1", now=100.0).allowed


class TestStaleSessions:
    def test_an_abandoned_session_stops_blocking_the_device(self):
        """A closed laptop never fires the end callback; the slot must expire."""
        limiter = device_limiter(cooldown_seconds=0, session_ttl=300.0)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        assert not limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=200.0).allowed
        assert limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0 + 301).allowed

    def test_reaping_also_releases_the_global_concurrency_slot(self):
        limiter = device_limiter(max_concurrent=1, session_ttl=300.0)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        assert not limiter.check_session("9.9.9.9", device_id=DEVICE_B, now=200.0).allowed
        assert limiter.check_session("9.9.9.9", device_id=DEVICE_B, now=100.0 + 301).allowed


class TestPerIpConcurrency:
    def test_one_network_cannot_hold_every_slot(self):
        limiter = device_limiter(max_per_ip=2)
        limiter.start_session("1.1.1.1", "s1", device_id="d1", now=100.0)
        limiter.start_session("1.1.1.1", "s2", device_id="d2", now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id="d3", now=100.0)
        assert not decision.allowed
        assert decision.reason == LimitReason.IP_CONCURRENCY

    def test_another_network_still_gets_through(self):
        limiter = device_limiter(max_per_ip=1)
        limiter.start_session("1.1.1.1", "s1", device_id="d1", now=100.0)

        assert limiter.check_session("2.2.2.2", device_id="d2", now=100.0).allowed


class TestCooldown:
    def test_immediate_redial_is_refused(self):
        limiter = device_limiter(cooldown_seconds=30)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=110.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=115.0)
        assert not decision.allowed
        assert decision.reason == LimitReason.COOLDOWN
        assert decision.retry_after > 0

    def test_the_wait_counts_from_the_start_of_the_last_session(self):
        limiter = device_limiter(cooldown_seconds=30)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=105.0)

        assert not limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=129.0).allowed
        assert limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=131.0).allowed

    def test_cooldown_is_per_device(self):
        limiter = device_limiter(cooldown_seconds=30)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=100.0)

        assert limiter.check_session("1.1.1.1", device_id=DEVICE_B, now=105.0).allowed


class TestPerDeviceWindows:
    def test_hourly_device_budget_is_spent_and_refills(self):
        limiter = device_limiter(per_device_hour=2, cooldown_seconds=0)
        for i in range(2):
            limiter.start_session("1.1.1.1", f"s{i}", device_id=DEVICE_A, now=100.0)
            limiter.end_session(f"s{i}", now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0)
        assert not decision.allowed
        assert decision.reason == LimitReason.DEVICE_HOURLY
        assert decision.retry_after > 0

        assert limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0 + HOUR + 1).allowed

    def test_daily_device_budget_outlasts_the_hourly_one(self):
        limiter = device_limiter(per_device_hour=10, per_device_day=2, cooldown_seconds=0)
        for i in range(2):
            limiter.start_session("1.1.1.1", f"s{i}", device_id=DEVICE_A, now=100.0 + i * HOUR * 2)
            limiter.end_session(f"s{i}", now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0 + 5 * HOUR)
        assert not decision.allowed
        assert decision.reason == LimitReason.DEVICE_DAILY

    def test_a_spent_day_is_named_even_when_the_hour_is_spent_too(self):
        """The hourly message would promise a slot the daily cap then refuses.

        Two calls fill the hour and a third fills the day, so both windows are
        full at once. Naming the hour here sends the visitor away for sixty
        minutes to be turned down again.
        """
        limiter = device_limiter(per_device_hour=2, per_device_day=3, cooldown_seconds=0)
        for i, when in enumerate([100.0, 100.0 + HOUR + 1, 100.0 + HOUR + 100]):
            limiter.start_session("1.1.1.1", f"s{i}", device_id=DEVICE_A, now=when)
            limiter.end_session(f"s{i}", now=when)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0 + HOUR + 200)
        assert not decision.allowed
        assert decision.reason == LimitReason.DEVICE_DAILY
        assert decision.retry_after > HOUR

    def test_clearing_site_data_still_hits_the_ip_ceiling(self):
        """The device id is spoofable; the IP cap is what actually holds."""
        limiter = device_limiter(per_ip_hour=3, per_device_hour=1, cooldown_seconds=0)
        for i in range(3):
            limiter.start_session("1.1.1.1", f"s{i}", device_id=f"fresh-{i}", now=100.0)
            limiter.end_session(f"s{i}", now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id="fresh-4", now=100.0)
        assert not decision.allowed
        assert decision.reason == LimitReason.IP_HOURLY


class TestQuotaReporting:
    def test_the_daily_allowance_is_reported_so_the_page_can_warn_first(self):
        """The warning says "3 a day"; that 3 has to come from the server."""
        limiter = device_limiter(per_device_day=3, per_ip_day=5)
        assert limiter.quota("1.1.1.1", DEVICE_A).per_day == 3

    def test_the_allowance_reported_is_the_tighter_of_the_two_layers(self):
        limiter = device_limiter(per_device_day=9, per_ip_day=4)
        assert limiter.quota("1.1.1.1", DEVICE_A).per_day == 4

    def test_a_fresh_visitor_sees_a_full_budget(self):
        limiter = device_limiter(per_device_hour=3, per_device_day=10)
        quota = limiter.quota("1.1.1.1", DEVICE_A, now=100.0)

        assert quota.remaining_hour == 3
        assert quota.remaining_day == 10
        assert quota.active_elsewhere is False
        assert quota.cooldown_remaining == 0
        assert quota.allowed is True

    def test_spending_a_session_shows_up_immediately(self):
        limiter = device_limiter(per_device_hour=3, cooldown_seconds=0)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=100.0)

        assert limiter.quota("1.1.1.1", DEVICE_A, now=100.0).remaining_hour == 2

    def test_remaining_never_goes_negative(self):
        limiter = device_limiter(per_device_hour=1, cooldown_seconds=0)
        for i in range(4):
            limiter.start_session("1.1.1.1", f"s{i}", device_id=DEVICE_A, now=100.0)
            limiter.end_session(f"s{i}", now=100.0)

        assert limiter.quota("1.1.1.1", DEVICE_A, now=100.0).remaining_hour == 0

    def test_an_open_tab_is_reported(self):
        limiter = device_limiter()
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        quota = limiter.quota("1.1.1.1", DEVICE_A, now=100.0)

        assert quota.active_elsewhere is True
        assert quota.allowed is False

    def test_cooldown_is_reported_as_a_countdown(self):
        limiter = device_limiter(cooldown_seconds=30)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)
        limiter.end_session("s1", now=100.0)

        quota = limiter.quota("1.1.1.1", DEVICE_A, now=110.0)
        assert 0 < quota.cooldown_remaining <= 30
        assert quota.allowed is False

    def test_the_ip_budget_caps_the_reported_figure(self):
        """Showing "3 left" when the network only has 1 left would be a lie."""
        limiter = device_limiter(per_device_hour=5, per_ip_hour=1, cooldown_seconds=0)
        quota = limiter.quota("1.1.1.1", DEVICE_A, now=100.0)

        assert quota.remaining_hour == 1


class TestRefusalOrdering:
    def test_your_own_open_tab_is_named_before_anything_else(self):
        limiter = device_limiter(max_concurrent=1, per_device_hour=0)
        limiter.start_session("1.1.1.1", "s1", device_id=DEVICE_A, now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0)
        assert decision.reason == LimitReason.DEVICE_ACTIVE

    def test_a_full_server_outranks_a_personal_budget(self):
        limiter = device_limiter(max_concurrent=1, per_device_hour=0, cooldown_seconds=0)
        limiter.start_session("9.9.9.9", "s1", device_id=DEVICE_B, now=100.0)

        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0)
        assert decision.reason == LimitReason.CONCURRENCY

    def test_every_refusal_carries_something_a_human_can_read(self):
        limiter = device_limiter(per_device_hour=0)
        decision = limiter.check_session("1.1.1.1", device_id=DEVICE_A, now=100.0)

        assert not decision.allowed
        assert decision.message
        assert decision.reason


class TestNoGlobalCeilingByDefault:
    """A portfolio wants to be popular.

    The per-device and per-IP layers refuse *abuse*: the same browser opening a
    second tab, the same network holding too many at once. A global concurrency
    cap is different in kind — it refuses a stranger who has done nothing, purely
    because other strangers arrived first. That is the one limit whose cost is
    paid by the people the site exists for, so it is off unless deliberately set.
    """

    def test_a_crowd_of_new_visitors_is_all_admitted(self):
        limiter = RateLimiter(
            per_ip_hour=99, per_ip_day=99, max_concurrent=0, per_device_hour=99
        )
        for i in range(50):
            assert limiter.check_session(f"ip{i}", device_id=f"d{i}", now=100.0).allowed
            limiter.start_session(f"ip{i}", f"s{i}", device_id=f"d{i}", now=100.0)

        assert limiter.check_session("late-arrival", device_id="d-late", now=100.0).allowed

    def test_the_abuse_layers_still_bite_with_no_global_cap(self):
        """Removing the ceiling must not remove the floor."""
        limiter = RateLimiter(
            per_ip_hour=99, per_ip_day=99, max_concurrent=0, max_per_ip=2, per_device_hour=99
        )
        limiter.start_session("1.1.1.1", "s1", device_id="d1", now=100.0)

        # Same browser, second tab.
        assert (
            limiter.check_session("1.1.1.1", device_id="d1", now=100.0).reason
            == LimitReason.DEVICE_ACTIVE
        )

        # Same network, third concurrent session.
        limiter.start_session("1.1.1.1", "s2", device_id="d2", now=100.0)
        assert (
            limiter.check_session("1.1.1.1", device_id="d3", now=100.0).reason
            == LimitReason.IP_CONCURRENCY
        )

    def test_a_ceiling_can_still_be_switched_back_on(self):
        """The lever remains, for the day a bill surprises."""
        limiter = RateLimiter(per_ip_hour=99, per_ip_day=99, max_concurrent=1, per_device_hour=99)
        limiter.start_session("1.1.1.1", "s1", device_id="d1", now=100.0)

        assert (
            limiter.check_session("2.2.2.2", device_id="d2", now=100.0).reason
            == LimitReason.CONCURRENCY
        )

    def test_the_daily_ceiling_is_independent_of_the_concurrency_cap(self):
        limiter = RateLimiter(
            per_ip_hour=99, per_ip_day=99, max_concurrent=0, daily_ceiling=2, per_device_hour=99
        )
        for i in range(2):
            limiter.start_session(f"ip{i}", f"s{i}", device_id=f"d{i}", now=100.0)
            limiter.end_session(f"s{i}", now=100.0)

        assert (
            limiter.check_session("3.3.3.3", device_id="d3", now=100.0).reason
            == LimitReason.DAILY_CEILING
        )
