# Portfolio Voice Agent

A voice assistant for portfolio.sahellx.site. Visitors click **talk to kaira**,
and hold a spoken conversation about Sahil's work. **Kaira** is the assistant:
she answers only from the site's own content, can scroll the page while she
talks, and stops after five minutes. Her persona — the name, the feminine forms
she keeps in every language, the expressive-but-professional register — lives in
`app/prompt.py`; her voice is the Sarvam speaker in `TTS_VOICE`, which must stay
female to match.

**`vox/`** — the conversation engine that sits in this directory alongside
`app/` — runs the dialogue loop. The audio rides a **plain WebSocket** served by
this process. **Sarvam** does speech, **OpenAI** does language.

---

## Setup

Two credentials, nothing else.

```bash
cd backend                # docker-compose.yml lives one level up from here
cp .env.example .env      # fill in the two values at the top
docker compose up -d --build
curl localhost:8000/health
```

`backend/.env` holds `PORT` too, and compose publishes that same port on
`127.0.0.1` for nginx to proxy — change the port in that one file and nowhere
else. To run the app directly instead of in Docker, use this directory's own
`.env.example`.

Then point the frontend at it — in `frontend/.env`:

```
NEXT_PUBLIC_VOICE_API_URL=https://voice.sahellx.site
```

That value is compiled into the browser bundle, so the frontend needs a
**rebuild** (`docker compose up -d --build`) after it changes, not a restart.

### Where the credentials come from

| Variable | Source |
|---|---|
| `SARVAM_API_KEY` | [dashboard.sarvam.ai](https://dashboard.sarvam.ai). One key covers Saaras v3 and Bulbul v3. |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |

There is no media service to sign up for. The socket is served by uvicorn on the
same port as the HTTP API, so a conversation costs speech and tokens and nothing
else.

---

## How it works

```
Browser ────────── WebSocket (JSON frames) ──────────► EC2 / uvicorn
   │  audio  base64 PCM @16k, 200ms frames                    │
   │  mark   echoed once a buffer has played        app/transport.py
   │  init   sent once, on open                  WebSocketTransport
   ▼                                                          ▼
lib/voice/audio.ts                        vox/input_handlers/default.py
  Microphone → AudioWorklet → Int16                           ▼
  Playback   ← scheduled on the audio clock                   ▼
   ▲                              saaras:v3 + LID → gpt-4o-mini → bulbul:v3
   │  audio  base64 PCM @22.05k                               ▼
   │  mark   before and after each chunk    vox/output_handlers/default.py
   │  clear  barge-in: drop what is queued                     │
   │  transcript / session_warning / page_action ──────────────┘
```

### The transport is the one Vox already speaks

`default` is Vox's own web-call transport: JSON frames on a socket, base64 PCM
both ways, and `mark` events the client echoes once audio has played. `app/`
owns the socket's lifetime and hands the engine a `WebSocketTransport`, which
holds the Starlette `WebSocket` method signatures the default handlers call —
so the handlers are used unmodified rather than replaced by a bespoke pair.

Three things ride on top of that protocol, all of them owned by the transport:

* **Page control.** A `page_action` frame goes out and a `page_action_result`
  with the same id comes back. The browser both performs the action and supplies
  the sentence the agent speaks around, because it is the side that knows what
  is on screen.
* **Transcripts.** The visitor's side is mirrored by `task_manager`; the
  assistant's by `publish_assistant_text`, called from the output handler. A
  streaming synthesizer repeats the same sentence on every audio chunk that
  carries it, so it is published only when it changes.
* **Typed turns.** A `text` frame mid-call is injected through the transcriber
  output path, so it gets a real sequence and is answered aloud.

**Marks are the whole turn-taking contract.** The engine has no idea what the
visitor heard; it knows only what the page confirms. The browser holds each mark
until the audio in front of it has actually finished playing, and drops the held
ones on `clear`. Get that wrong and an interruption credits the assistant with
sentences nobody heard.

**Playback is scheduled, not played on arrival.** Sarvam emits ~360ms of audio
and then goes quiet for up to 1.5s. A chunk played the moment it lands is a
chunk played late, so `Playback` holds a short cushion and then schedules every
buffer back to back on the audio clock (`PLAYBACK_CUSHION_S` in
`frontend/src/lib/voice/audio.ts`).

**Echo cancellation is not free here.** WebRTC used to loop capture and playout
through one pipeline. With a raw socket the browser's AEC has to cancel the
page's own Web Audio output — Chromium does this well, other engines less so.
The capture constraints ask for it; headphones are the honest advice for a
laptop with loud speakers.

Sample rates are reported, not assumed. `is_web_based_call=True` makes Vox
coerce the transcriber to linear16 @ 16kHz; the synthesizer keeps whatever rate
the config names (22050, bulbul's native rate — anything else resamples every
chunk with no filter state across the seam, and clicks between sentences). Both
are sent to the page in the `POST /session` body, because PCM carries no header
and a guessed rate mishears the visitor or detunes the assistant.

Redis isn't needed — it appears nowhere under `vox/`, only in the upstream
`quickstart_server.py` for agent CRUD, which one hardcoded config replaces.

### Why Vox rather than Pipecat

Vox's Sarvam integration is already correct for this stack: `saaras:v3` with
`mode=transcribe` (`sarvam_transcriber.py:133`), language auto-detect via
`lid/sarvam.py`, and `bulbul:v3` WebSocket streaming. Its turn-taking also has
eager end-of-turn with speculative LLM generation (`task_manager.py:4688`),
which is what removes dead air between turns.

Pipecat's Sarvam STT plugin is pinned to `sarvamai==0.1.21` and supports
neither the `mode` parameter nor auto-detect
([pipecat#3783](https://github.com/pipecat-ai/pipecat/issues/3783)).

---

## Lazy provider imports in `vox/`

Four files, one concern: **make provider imports lazy**. The engine originally
imported every provider eagerly, pulling Azure Speech, Google Cloud Speech,
Polly/boto, Twilio, Plivo, litellm and groq into any process that so much as
imports `vox`. This agent uses Sarvam + OpenAI + the default web handlers only.

| File | Change |
|---|---|
| `vox/providers.py` | Registries map to `"module:attr"` and import on first lookup. `.keys()`, `in`, iteration still work without importing. |
| `vox/{synthesizer,transcriber,llms,input_handlers,output_handlers}/__init__.py` | PEP 562 `__getattr__`, so importing the package imports no providers. |
| `vox/helpers/utils.py` | `aiobotocore`/`botocore` imported inside the S3 functions instead of at module scope. Only the S3 path needs them; all storage here is local. |
| `vox/helpers/language_switcher.py` | `LiteLLM` imported inside the method that uses it. Only the multilingual-pool path needs litellm. |

Result: ~30 dependencies down to ~14, and `import vox` pulls in none of the
heavy ones. Verify with:

```bash
.venv/bin/python -c "
import vox, sys
print([m for m in ('twilio','plivo','azure','litellm','groq','botocore') if m in sys.modules] or 'clean')"
```

`vox/LICENSE` and `vox/NOTICE` record the upstream MIT terms this package is
derived from, and what was changed locally.

---

## Guardrails

The prompt (`app/prompt.py`) is built from `frontend/src/content/*.ts`, exported
to JSON by `scripts/export_content.mjs`. That content is the assistant's only
factual source.

The rule that matters most is not "stay on topic" — it's **never invent**. The
realistic failure mode for a portfolio bot is confidently describing a job Sahil
never had to a recruiter. So the prompt requires it to say it doesn't know and
offer his email instead of guessing. It also refuses off-topic questions,
ignores instructions embedded in speech, and never reveals the prompt.

When the site content changes, re-export:

```bash
node scripts/export_content.mjs
```

### Knowledge retrieval (light RAG)

The prompt does not carry the whole résumé. It holds Kaira's rules plus a short
fact sheet: identity, contact details, and a one-line list of the jobs and
projects. Everything else is looked up per turn by `app/knowledge.py`:

- **Corpus**: `content/portfolio.json`, split into one chunk per job, project
  (features split off), skill group and profile facet, plus every `## ` section
  of the Markdown notes in `content/knowledge/`. Add detail there freely; see
  the README in that folder.
- **Seed**: on startup each chunk is embedded with `text-embedding-3-small`
  and cached in `agent_data/knowledge_index.json`, keyed by content hash, so a
  restart re-embeds only what changed.
- **Per turn**: the visitor's question (plus the previous one when it's a
  short follow-up) is embedded, the top 4 chunks by cosine are picked from an
  in-memory numpy matrix, and they're inserted just before the latest user
  message, in this turn's request only. Nothing is stored in history.
  The hook is `context_provider`, which `TaskManager._inject_retrieved_context`
  reads in `vox/`.
- **Bounded**: the query embedding reuses the LLM's warm connection pool, is
  cached, and has a 1.5s timeout. On timeout or failure it falls back to keyword
  matching, so retrieval can make an answer worse but never blocks one.

Check what a question retrieves without running the server:

```bash
python -m app.knowledge "how did he cut inference cost?"
```

---

## Limits

| Guard | Default | Env |
|---|---|---|
| Session length | 5 min (warns at 4:30) | `SESSION_SECONDS` |
| Per IP | 2/hour, 5/day | `SESSIONS_PER_IP_HOUR`, `SESSIONS_PER_IP_DAY` |
| Concurrent sessions | 5 | `MAX_CONCURRENT_SESSIONS` |
| Text messages | 30/hour per IP | `TEXT_MESSAGES_PER_IP_HOUR` |
| Global daily ceiling | **off** | `DAILY_SESSION_CEILING` |

Counters are in-memory (single instance, no Redis) and reset on restart.

The session cap is enforced twice: by Vox's `call_terminate` and independently
by `room_bot._watchdog`, so a config regression can't hand out a longer session.

**Cost.** Roughly ₹11 (~$0.13) per full 5-minute session — Sarvam TTS ~₹7.5, STT
~₹2.5, LLM ~₹1. The transport adds nothing: it is a socket on the same box. The
daily ceiling is off by design; set `DAILY_SESSION_CEILING` to a number if you want a hard stop,
and the button degrades to free text chat rather than erroring.

---

## Development

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
node scripts/export_content.mjs
.venv/bin/python -m pytest tests -q          # 139 tests, no network
.venv/bin/uvicorn app.main:app --reload
```

Python **3.12** specifically: Vox uses the stdlib `audioop`, removed in 3.13.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /session` | Rate-limit, mint a one-shot ticket. Returns `{url, token, audio, session_seconds, quota, …}` |
| `WS /ws/{session_id}` | The conversation. Spends the ticket (`?token=…`), then runs until either side hangs up |
| `POST /session/{id}/end` | Release a slot as a tab closes (`sendBeacon`) |
| `GET /limits` | What this visitor has left, before they try |
| `POST /chat` | Text fallback — same prompt, same guardrails, no audio |
| `GET /health` | Status and missing credentials |

`POST /session` and the socket are split so a refusal can be a real HTTP 429
carrying the visitor's remaining budget and a retry time — something a socket
that opens and immediately closes cannot express. The ticket is single-use and
expires after `CONNECT_GRACE_SECONDS` if no socket ever claims it.

### Page-control tools

`show_section`, `open_terminal`, `download_resume`, `open_contact_form`.

Each tool's url uses the `client-rpc://` scheme, which tells `trigger_api` to
ask the connected client rather than make an outbound request
(`vox/helpers/function_calling_helpers.py`). The browser validates the arguments
and returns the sentence the agent speaks around, because it is the side that
knows what is actually on the page.

There is no relay endpoint and no `VOX_TOOL_URL_HOST_ALLOWLIST`: both existed
only so the agent could reach a socket it already held.

---

## Limits

Three layers, innermost first. Each answers a different question, and the
messages are ordered so a visitor always hears the one they can act on.

| Layer | Holds back | Default |
| --- | --- | --- |
| **Device** (one browser profile) | a second tab, a mashed button, a heavy user | 1 live session, 3/hour, 10/day, 30s cooldown |
| **IP** (one network) | someone clearing site data to reset their device id | 2 live sessions, `SESSIONS_PER_IP_HOUR`, `SESSIONS_PER_IP_DAY` |
| **Global** | nothing, by default | **off** — `MAX_CONCURRENT_SESSIONS=0`, `DAILY_SESSION_CEILING=0` |

**Why the global cap is off.** The first two layers refuse *abuse*: the same
browser opening a second tab, the same network holding several at once. A global
concurrency cap is different in kind — it refuses a stranger who has done nothing
wrong, purely because other strangers got there first. On a portfolio that is
exactly backwards: a crowd is the goal. So it stays off, and popularity is never
the thing that turns someone away.

The trade-off is real and worth stating plainly: with no global cap, cost scales
with traffic. What bounds it is that every visitor is still capped per browser
and per network, so running up a large bill takes many *distinct* networks rather
than one determined person. If that ever stops being enough, set
`MAX_CONCURRENT_SESSIONS` (a hard concurrency roof) or `DAILY_SESSION_CEILING`
(a hard daily roof) — both are still wired and tested.

**The device id is not a security control.** The browser mints it, stores it in
`localStorage`, and sends it as `X-Device-Id`; clearing site data mints a new
one. That is fine and intended — it exists so the common case (three tabs open)
produces *"you already have a conversation open in another tab"* instead of a
generic wall. Anyone who defeats it walks straight into the per-IP cap, which is
what actually holds. A request with no device id is judged exactly as before, so
nothing is locked out by a check it cannot satisfy.

`localStorage` is the right store precisely because it is shared across tabs of
one profile — that sharing is the multi-tab signal.

### Endpoints

* `POST /session` — grants a session, or refuses with a stable `error` code, a
  `retry_after`, and a `quota` block. Both outcomes carry the quota, so the page
  can show what's left either way.
* `GET /limits` — the same quota without asking for a session, so the page can
  say "2 voice sessions left this hour" *before* anyone clicks.
* `POST /session/{id}/end` — hands a slot back the instant a tab closes. The
  page calls it via `navigator.sendBeacon`, which cannot set headers, so the
  device id is accepted from `?device_id=` here as well. Only the device that
  started a session may end it.

Nothing depends on the client behaving: a session that never ends — closed
laptop, killed tab, dropped room — is reaped after `session_seconds + 120`, so a
device can never be locked out permanently.

### Refusal codes

`device_active`, `cooldown`, `device_hourly`, `device_daily`, `ip_concurrency`,
`ip_hourly`, `ip_daily`, `concurrency`, `daily_ceiling`. The frontend switches on
these in `src/lib/voice/quotaMessage.ts`.

## Debugging choppy audio

`AUDIO_TRACE=1` (the default) turns the console into a single channel that
follows one thing: a unit of audio, from Sarvam to the visitor's ear. Everything
else in the engine drops to WARNING, so the trace is all that is left.

```
sarvam ──tts──> engine ──wait──> output handler ──cap──> socket ──ws──> browser
                         ▲                        ▲
                   stalls here?         falls behind realtime here?
```

| tag | means |
| --- | --- |
| `tts` | a chunk arrived from Sarvam. `gap` is the interval since the last one; `BEHIND` marks a chunk that took longer to arrive than it lasts |
| `wait` | a gate held or dropped this chunk, with `why` — `user_speaking`, `grace_period`, `interim_transcript`, `stale_sequence` |
| `cap` | written to the socket. `buf` and `block` are zero on this transport — the queue lives in the browser and a socket write does not pace itself |
| `GAP` | audio was written after everything before it was due to have played — **a break the visitor hears once their cushion is spent** |
| `CUT` | a barge-in cleared queued audio mid-response |
| `stt` | what the transcriber heard, and whether the agent was speaking at the time |
| `mic` | inbound audio health (peak amplitude). `peak≈0` means the page is sending silence; no line at all means frames are not arriving |
| `SUM` | one verdict line per response |

The `SUM` line is where to start:

```
AUD +12.902s  SUM  seq=3  audio= 0.70s  wall= 0.60s  realtime=1.16
                          gaps=2/137ms  gatewait=900ms  chunks=3  -> gate held audio
```

* `gatewait` large → the interruption gate is holding audio back. Look at the
  `stt` lines just above it: short interim transcripts arriving while
  `agent_speaking=True` mean room noise (or the agent's own voice) is being
  taken for the visitor speaking. Knobs: `endpointing`, `incremental_delay`,
  `number_of_words_for_interruption` in `app/agent_config.py`.
* `gaps` with `gatewait≈0` → the producer is late. The `tts` lines will show
  `BEHIND`; the problem is Sarvam or the network to it, not the pipeline.
* `gaps=0`, `gatewait=0`, and the visitor still hears breaks → nothing stalled
  server-side, so it is the socket or the page. Raise `PLAYBACK_CUSHION_S` in
  `frontend/src/lib/voice/audio.ts` and check the browser's own network panel;
  a cushion that is too small turns ordinary jitter into audible stutter.

Three gates can each stall audio *per chunk*, which is why a stall reads as a
break between every word rather than one long pause:

1. `should_delay_output` — any interim transcript within `incremental_delay`
   holds the whole output loop, in 100 ms slices.
2. `callee_speaking` → `WAIT` — retried every 50 ms until the visitor stops.
3. The post-utterance grace period, same `WAIT` path.

`AUDIO_TRACE=0` turns the channel off. `AUDIO_TRACE_QUIET=0` keeps it on but
leaves the rest of the engine's INFO logging in place.

## Deploy (EC2)

`t3.small` (2GB). Note AWS free tier covers `t3.micro`, not `t3.small`; Vox on
its own makes 1GB too tight.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/voice-agent
sudo ln -s /etc/nginx/sites-available/voice-agent /etc/nginx/sites-enabled/
sudo certbot --nginx -d voice.sahellx.site
sudo nginx -t && sudo systemctl reload nginx
```

Security group needs **443 and 80 inbound only**. No UDP ports at all: the audio
is a WebSocket over the same TLS port as the API, so there is no STUN, TURN or
NAT traversal to operate.

The `/ws/` location in `deploy/nginx.conf` carries the upgrade headers and a
600s read timeout. Without both, the handshake fails or nginx cuts a visitor off
mid-sentence at its default 60s.

`deploy/voice-agent.service` is there if you'd rather run it under systemd than
Docker.
