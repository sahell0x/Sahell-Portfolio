import threading
import httpx

_pool: dict[tuple, httpx.AsyncClient] = {}
_lock = threading.Lock()


def get_shared_http_client(base_url: str | None = None, http2: bool = True) -> httpx.AsyncClient:
    key = (base_url, http2)
    client = _pool.get(key)
    if client is None:
        with _lock:
            client = _pool.get(key)
            if client is None:
                # keepalive_expiry was 30s. A voice turn is often further apart
                # than that — the visitor thinks, or listens to a long answer —
                # and dropping the connection makes the next turn pay a fresh
                # TLS handshake, which on a poor route to the provider is
                # seconds of dead air rather than milliseconds.
                limits = httpx.Limits(max_connections=200, max_keepalive_connections=200, keepalive_expiry=120)
                client = httpx.AsyncClient(limits=limits, timeout=httpx.Timeout(600.0, connect=10.0), http2=http2)
                _pool[key] = client
    return client
