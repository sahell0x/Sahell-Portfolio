# Projects Infrastructure and Work Experience

## HootPR Cloud Deployment and Architecture
HootPR (https://hootpr.sahell.in) is an automated PR review platform for GitHub and GitLab built using Python, LangGraph, FastAPI, Celery, PostgreSQL, pgvector, Redis, Docker, and MCP. The production platform is deployed on AWS EC2 (small instance) with AWS RDS. It clones pull requests into sealed, network-isolated sandboxes, analyzes code using Semgrep and tree-sitter, runs LLM agent inspections with tool calling (capped at 8 calls and 60k tokens), filters findings with an LLM judge, and supports autofixing, test generation, and CI build repairs.

## Assay Equity Research Agent Architecture and AWS Deployment
Assay (https://assay.sahell.in) is an AI equity research agent built with Python, LangGraph, FastAPI, PostgreSQL, pgvector, Redis, ARQ, OpenAI API, Next.js, and TypeScript, deployed on AWS EC2 (small instance) with AWS RDS. It fetches SEC EDGAR 10-K filings, computes financial ratios in pure Python, verifies all numbers, benchmarks against peers across 27 metrics in 5 dimensions, and outputs cited BUY/HOLD/SELL memos with scenario analysis and Razorpay credits.

## Affimintus Technologies Full-Stack Internship
During his Software Developer Internship at Affimintus Technologies in Indore (June 2024 – November 2024), Sahil worked across the full stack on an e-commerce platform. He built REST APIs in Express with PostgreSQL and secure JWT-based authentication, integrated them with a React and TypeScript frontend styled with Tailwind CSS, and optimized frontend performance using Recoil state management, reducing initial page load times by 25%.
