# Sahil Khan — Portfolio

A dual-mode developer portfolio: a clean, readable page for everyone, plus an
**interactive terminal** (`launch_terminal`) that technical visitors can use to
explore the site by typing commands. Both modes read from a single content
source, so they never drift apart.

Built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS v4**,
and **Motion**. Plain monochrome design in light and dark — no brand hue;
emphasis comes from contrast and weight.

## Features

- 🖥️ **Interactive terminal** — `whoami`, `projects`, `experience`, `skills`,
  `contact`, `resume`, `neofetch`, `theme`, tab-completion, command history,
  easter eggs.
- 📄 **Single source of truth** — all content lives in `src/content/`; the page
  and the terminal both import it.
- ✉️ **Working contact form** — server route (`/api/contact`) using
  [Resend](https://resend.com), with Zod validation and a honeypot.
- 🌗 **Light / dark** — follows the OS until the visitor picks with the nav
  toggle or `theme dark|light|system` in the terminal; the choice is remembered
  and applied before first paint, so there is no flash.
- 🔎 SEO: metadata, dynamic OpenGraph image, `sitemap.xml`, `robots.txt`.
- 📊 Vercel Analytics.

## Theming

All colour lives in custom properties at the top of `src/app/globals.css`
(`--bg`, `--surface`, `--ink`, `--dim`, `--faint`, `--edge`, …), exposed to
Tailwind through `@theme inline`. Redefining those properties under the light
and dark blocks re-themes the entire site, terminal and voice widget included —
no component knows a colour value.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in RESEND_API_KEY (optional for local)
npm run dev
```

Open http://localhost:3000.

> Note: `next dev`/`next build` use Turbopack by default. If a build crashes in
> a constrained environment, use `npx next build --webpack`.

## Editing content

Everything a recruiter sees comes from `src/content/`:

| File            | What it holds                                  |
| --------------- | ---------------------------------------------- |
| `profile.ts`    | name, title, roles, bio, contact, stats, edu   |
| `skills.ts`     | grouped tech stack                             |
| `experience.ts` | work history                                    |
| `projects.ts`   | projects (update the `links.github` URLs)      |
| `socials.ts`    | social links                                   |

Add a project once → it appears in **both** the Projects section and
`ls projects` in the terminal.

## Contact form setup (Resend)

1. Create a free account at [resend.com](https://resend.com) and an API key.
2. Add env vars (locally in `.env.local`, on Vercel in Project → Settings →
   Environment Variables):
   - `RESEND_API_KEY`
   - `CONTACT_TO_EMAIL` (defaults to `s.sahil9752@gmail.com`)
   - `CONTACT_FROM_EMAIL` (use `onboarding@resend.dev` until you verify a domain)

Without a key, the form fails gracefully and points visitors to email directly.

## Run everything with Docker (one command)

From the repo root:

```bash
cp .env.example .env          # FRONTEND_PORT / BACKEND_PORT live here
docker compose up -d --build
```

Each app still reads its own settings from `frontend/.env` and `backend/.env`.
The root `.env` only picks the ports on your machine. If a port is already
taken, change `FRONTEND_PORT` or `BACKEND_PORT` there and run
`docker compose up -d --build` again. The frontend's link to the backend and the
backend's CORS list follow the new ports on their own.

## Deploy with Docker (each app on its own)

Two independent stacks, each with its own compose file and its own `.env` in
its own root folder. Neither knows about the other, so they can be built,
restarted and moved between machines separately.

| | Frontend | Backend |
|---|---|---|
| compose file | `frontend/docker-compose.yml` | `backend/docker-compose.yml` |
| env file | `frontend/.env` | `backend/.env` |
| build context | `frontend/` | `backend/voice-agent/` |
| default port | `3000` | `8000` |
| nginx site | `frontend/deploy/nginx.conf` | `backend/voice-agent/deploy/nginx.conf` |

```bash
# backend — the voice agent
cd backend
cp .env.example .env          # SARVAM_API_KEY, OPENAI_API_KEY, PORT
docker compose up -d --build
curl localhost:8000/health

# frontend — the site
cd ../frontend
cp .env.example .env          # RESEND_API_KEY, NEXT_PUBLIC_VOICE_API_URL, PORT
docker compose up -d --build
curl -I localhost:3000
```

### Ports

`PORT` in each `.env` is the only place a port is named. The container listens
on it *and* compose publishes the same number on the host, so nginx proxies to
`http://127.0.0.1:$PORT`. Change the number, `docker compose up -d`, and update
the matching `proxy_pass` in that stack's nginx site file (nginx can't read
`.env`).

`BIND_HOST` defaults to `127.0.0.1`, so neither container is reachable from
outside the machine — nginx terminates TLS and is the only way in. That is also
what makes it safe for the backend to trust `X-Forwarded-For` for rate
limiting. Set `BIND_HOST=0.0.0.0` only if the proxy runs on a different host,
and firewall the port if you do.

Both `.env` files also carry `IMAGE_NAME`, `CONTAINER_NAME`,
`COMPOSE_PROJECT_NAME`, `NETWORK_NAME` and `MEMORY_LIMIT`, so two copies can run
side by side on one box without colliding.

### One thing to remember

`NEXT_PUBLIC_VOICE_API_URL` is compiled into the browser bundle at build time.
After changing it, redeploy the frontend with `--build`; a plain restart keeps
the old value.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add the environment variables above.
4. Set the custom domain `portfolio.sahellx.site` in Project → Settings →
   Domains.

## Résumé

The downloadable résumé lives at `public/sahil_khan_resume.pdf`. Replace that
file to update it.
