export interface Project {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** One-line points. Used where a project has no `features` grid. */
  highlights: string[];
  /** What the system actually does — a titled grid, read before the stack. */
  features?: { title: string; detail: string }[];
  stack: string[];
  tags: string[];
  links: {
    // NOTE: update these to the exact repo / live URLs when available.
    // `demo` is still a placeholder (example.com) on every project.
    github?: string;
    demo?: string;
  };
}

export const projects: Project[] = [
  {
    slug: "hootpr",
    name: "HootPR",
    tagline: "AI code reviewer that reads, runs and fixes pull requests",
    description:
      "An AI review platform for GitHub and GitLab. Every pull request is cloned into a sealed sandbox, mapped with a code graph, scanned by static analyzers and investigated by tool-using LLM agents — then a judge model throws out anything it can't back with evidence. What survives lands on the PR as a walkthrough, inline comments with one-click fixes and a merge check. Ask it, and it writes the fix, the tests or the CI repair too.",
    highlights: [],
    features: [
      {
        title: "Agentic review pipeline",
        detail:
          "Triage → plan → investigator agents that read files, walk callers and callees, and run shell commands inside the sandbox — each capped at 8 tool calls and 60k tokens.",
      },
      {
        title: "Built-in hallucination control",
        detail:
          "A finding must sit inside the diff, apply cleanly as a patch and pass an LLM judge's confidence bar. Linter output is evidence for the agents, never posted raw.",
      },
      {
        title: "Sealed, disposable sandbox",
        detail:
          "Read-only, non-root, no capabilities, 768 MB; the network is cut after the clone and the container is destroyed after. Repo text is fenced off as untrusted input against prompt injection.",
      },
      {
        title: "It writes the fix, too",
        detail:
          "@hootpr autofix, generate unit tests (run and iterated until they pass), fix CI from the failed job logs, resolve merge conflicts — pushed as a commit or a stacked PR.",
      },
      {
        title: "Security suite",
        detail:
          "Blast radius traces changed code back to the HTTP routes it can reach; a repo-wide attack-surface map and an on-demand security architecture review.",
      },
      {
        title: "Learns each team",
        detail:
          "Preferences taught in the PR thread are embedded in pgvector and recalled on the next review. Linked repos, remote MCP servers and web search add context.",
      },
      {
        title: "Dashboard with a full trace",
        detail:
          "Every review's stages, agent steps, LLM calls, tool runs and judge verdicts; a Monaco diff workspace with findings inline; analytics, reports, audit log and a public REST API.",
      },
      {
        title: "Measured, not guessed",
        detail:
          "An eval suite of seeded bugs, reversed CVE fixes and clean PRs scores precision, recall and cost per PR, with ablations that switch stages off.",
      },
    ],
    stack: [
      "Python",
      "LangGraph",
      "RAG",
      "FastAPI",
      "Celery",
      "PostgreSQL",
      "pgvector",
      "Redis",
      "Docker",
      "tree-sitter",
      "Semgrep",
      "MCP",
      "Next.js",
      "TypeScript",
      "Razorpay",
    ],
    tags: ["AI Agents", "DevTools", "Security"],
    links: {
      github: "https://github.com/sahell0x/HootPR",
      demo: "https://hootpr.sahell.in",
    },
  },
  {
    slug: "assay",
    name: "Assay",
    tagline: "AI equity research agent — a report card for every stock",
    description:
      "Type a US ticker and Assay reads the company's financials and SEC filings, computes every ratio in Python, benchmarks them against peers, and grades the business on profitability, financial health, growth, valuation and sentiment — then writes a cited investment memo with a BUY / HOLD / SELL call. The LLM writes the argument; it never produces a number and never picks the rating.",
    highlights: [],
    features: [
      {
        title: "Every number is verified",
        detail:
          "Ratios are computed in pure Python. After the memo is written, every %, multiple and dollar figure is extracted and matched against those values — a transposed digit sends it back for a rewrite.",
      },
      {
        title: "A rubric makes the call",
        detail:
          "27 metrics are scored 0–10 against named anchors and folded into five weighted dimensions. The model is told the rating and argues for it; if it disagrees, that goes in the caveats.",
      },
      {
        title: "Every claim is cited",
        detail:
          "Qualitative sentences must cite a retrieved passage. Uncited claims, or citations to sources that don't exist, are removed before the memo is saved.",
      },
      {
        title: "Retrieval led by the numbers",
        detail:
          "10-Ks streamed from SEC EDGAR plus news, chunked into pgvector. When revenue fell or leverage is high, it searches specifically for demand weakness or refinancing risk.",
      },
      {
        title: "Peer benchmarking",
        detail:
          "Each metric gets a percentile against comparable companies — “operating margin 31%, better than 88% of peers” — with meaningless multiples filtered out.",
      },
      {
        title: "“What would make it a BUY?”",
        detail:
          "The rubric runs backwards: a Scenario tab solves the smallest move in each metric that flips the rating, with draggable levers — no data fetch and no model call.",
      },
      {
        title: "Live pipeline, full trace",
        detail:
          "Server-sent events stream each node as it finishes; the trace tab shows tokens, cost and citation rate for every run.",
      },
      {
        title: "A complete product",
        detail:
          "Accounts with Google sign-in, compare, watchlist, PDF export, public share links, credits via Razorpay (test mode), quotas and a daily LLM budget guard.",
      },
    ],
    stack: [
      "Python",
      "LangGraph",
      "RAG",
      "FastAPI",
      "PostgreSQL",
      "pgvector",
      "Redis",
      "ARQ",
      "SEC EDGAR",
      "OpenAI API",
      "Next.js",
      "TypeScript",
      "Razorpay",
    ],
    tags: ["RAG", "Agents", "Finance"],
    links: {
      github: "https://github.com/sahell0x/Assay-Finance",
      demo: "https://assay.sahell.in",
    },
  },
];
