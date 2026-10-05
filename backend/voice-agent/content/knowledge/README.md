# Kaira's extra knowledge

Everything here is what Kaira can know about Sahil beyond what the site shows.
It isn't sent in the prompt. Each `## ` section becomes one searchable passage,
and Kaira gets only the few passages that match what the visitor asked.

- One topic per file, e.g. `voice-platform-deep-dive.md`, `why-ai-engineering.md`.
- Start the file with a `# Title`. Each `## Section` under it is one passage,
  so keep a section to one idea, a short paragraph or a few bullets.
  Section titles help retrieval, so make them specific
  ("How the vLLM cost cut worked", not "Details").
- Write facts only. Kaira treats every line here as true and will say it to
  a recruiter.
- This README is never indexed.

The index re-seeds on startup and re-embeds only the sections that changed.
To check what a question pulls in without starting the server:

    python -m app.knowledge "how did he cut inference cost?"
