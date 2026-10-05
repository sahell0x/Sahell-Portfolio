export interface Job {
  company: string;
  role: string;
  period: string;
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
    current: true,
    summary:
      "Building a real-time, multi-tenant voice-agent platform and the LLM infrastructure behind it.",
    highlights: [
      "Architected a high-throughput, “true natural” voice-agent platform with Pipecat, orchestrating diverse STT/TTS engines and LLM APIs (OpenAI, Gemini) for sub-second conversational latency.",
      "Built a FastAPI backend managing multi-tenant agent sessions as a service, integrating Twilio & Plivo to scale concurrent active calls by 60%+.",
      "Deployed and optimized open-source LLMs on RunPod GPUs (RTX 3090) with vLLM — a 40% reduction in inference cost while holding real-time latencies.",
      "Built a RAG system (LangChain + Pinecone + OpenAI text-embedding-3-small) serving contextual answers over 100,000+ document chunks with sub-200ms query latency.",
    ],
    stack: [
      "Python",
      "FastAPI",
      "vLLM",
      "RunPod",
      "Pipecat",
      "Twilio",
      "Plivo",
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
    summary:
      "Contributed reliability and response-handling features to an open-source API client.",
    highlights: [
      "Added API response download and seamless image-response handling / UI rendering for REST APIs — 100% accurate binary image processing.",
      "Implemented WebSocket disconnection detection with real-time UI alerts, improving platform stability.",
    ],
    stack: ["TypeScript", "React.js", "WebSocket", "REST APIs"],
  },
  {
    company: "Affimintus Technologies",
    role: "Software Developer Intern",
    period: "Jun 2024 — Nov 2024",
    summary: "Full-stack feature work focused on performance and authentication.",
    highlights: [
      "Cut initial page load time by 25% and reduced average API response time by 20% for key user flows.",
      "Implemented JWT-based auth in Express and Recoil state management, improving scalability and reducing state-related bugs.",
    ],
    stack: ["Node.js", "Express.js", "JWT", "Recoil", "React.js"],
  },
];
