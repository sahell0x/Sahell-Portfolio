export interface Job {
  company: string;
  role: string;
  period: string;
  location?: string;
  current?: boolean;
  summary: string;
  highlights: string[];
  stack: string[];
  link?: string;
}

export const experience: Job[] = [
  {
    company: "Purple Sky Infotech",
    role: "Software Engineer",
    period: "Jun 2025 — Present",
    location: "Barwani, Madhya Pradesh",
    current: true,
    summary:
      "Building a real-time, multi-tenant voice-agent platform and the LLM infrastructure behind it.",
    highlights: [
      "Architected the voice agent orchestration layer for the platform using Pipecat and async processing, delivering real-time conversational voice with end-to-end latency under 1500 ms and support for multiple LLM, TTS, and STT providers.",
      "Built a high-performance RAG microservice for the voice agent platform using LangChain, Pinecone, and OpenAI text-embedding-3-small, integrated with AWS S3 for document uploads, AWS SQS queuing, and async Celery workers, serving 100,000+ chunks with retrieval latency under 300 ms.",
      "Deployed Qwen2.5-72B-Instruct using vLLM with tool calling and Faster-Whisper large-v3 for transcription on an on-premises 8x V100 GPU server, cutting LLM development and testing costs by 90% compared to cloud providers.",
      "Deployed and optimized open-source LLMs on RunPod GPUs (RTX 3090) with vLLM — a 40% reduction in inference cost while holding real-time latencies.",
      "Integrated multiple telephony providers including Twilio, Plivo, and Vobiz into the voice platform, along with automated call retry handling to scale concurrent active calls by 60%+.",
    ],
    stack: [
      "Python",
      "FastAPI",
      "Pipecat",
      "vLLM",
      "Qwen2.5",
      "Faster-Whisper",
      "RunPod",
      "Celery",
      "AWS SQS",
      "AWS S3",
      "Twilio",
      "Plivo",
      "Vobiz",
      "OpenAI",
      "Gemini",
      "Docker",
      "LangChain",
      "Pinecone",
    ],
  },
  {
    company: "Sparrow — Techdome",
    role: "Core Contributor · Open Source",
    period: "2025",
    location: "Indore, Madhya Pradesh",
    link: "https://sparrowapp.dev",
    summary:
      "Contributed reliability and response-handling features to an open-source API client.",
    highlights: [
      "Built an AI-powered XML/JSON response visualizer generating HTML views of complex API response bodies similar to Postman, reaching 99.98% rendering accuracy in testing.",
      "Added API response download features and image response rendering for REST APIs handling binary image data — 100% accurate binary image processing.",
      "Implemented WebSocket disconnection detection with real-time UI alerts, improving platform stability.",
    ],
    stack: [
      "TypeScript",
      "Svelte",
      "Rust",
      "Tauri",
      "LLM",
      "OpenAI",
      "React.js",
      "WebSocket",
      "REST APIs",
    ],
  },
  {
    company: "Affimintus Technologies",
    role: "Software Developer Intern",
    period: "Jun 2024 — Nov 2024",
    location: "Indore, Madhya Pradesh",
    summary:
      "Full-stack feature work on an e-commerce platform focused on performance, REST APIs, and authentication.",
    highlights: [
      "Worked across the full stack on an e-commerce platform: built REST APIs in Express with Postgres and a secure JWT-based authentication flow, integrating them into a React and TypeScript frontend styled with Tailwind CSS.",
      "Optimized frontend performance and implemented Recoil-based state management, reducing initial page load times by 25% and cutting state-related bugs.",
      "Cut average API response time by 20% for key user flows.",
    ],
    stack: [
      "Node.js",
      "Express.js",
      "PostgreSQL",
      "JWT",
      "Recoil",
      "React.js",
      "TypeScript",
      "Tailwind CSS",
    ],
  },
];
