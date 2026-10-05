export interface SkillGroup {
  label: string;
  /** short lowercase key used by the terminal */
  key: string;
  items: string[];
}

export const skillGroups: SkillGroup[] = [
  {
    label: "AI / ML",
    key: "ai",
    items: [
      "LLMs (OpenAI, Gemini)",
      "RAG",
      "LangChain",
      "LangGraph",
      "vLLM",
      "Pinecone",
      "Pipecat",
      "Prompt Engineering",
      "text-embedding-3",
    ],
  },
  {
    label: "Backend",
    key: "backend",
    items: [
      "FastAPI",
      "Express",
      "Node.js",
      "Python",
      "WebSocket",
      "REST APIs",
      "JWT Auth",
    ],
  },
  {
    label: "Data & Infra",
    key: "infra",
    items: [
      "PostgreSQL",
      "MongoDB",
      "Redis",
      "AWS (EC2, S3, Lambda)",
      "Docker",
      "RunPod GPU",
      "Twilio",
      "Plivo",
    ],
  },
  {
    label: "Frontend",
    key: "frontend",
    items: ["React.js", "TypeScript", "Tailwind CSS", "Recoil", "Socket.io"],
  },
  {
    label: "Languages",
    key: "languages",
    items: ["JavaScript", "TypeScript", "Python", "C / C++"],
  },
];
