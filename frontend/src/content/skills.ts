export interface SkillGroup {
  label: string;
  /** short lowercase key used by the terminal */
  key: string;
  items: string[];
}

export const skillGroups: SkillGroup[] = [
  {
    label: "Programming Languages",
    key: "languages",
    items: ["JavaScript", "Python", "C/C++"],
  },
  {
    label: "Technologies & Tools",
    key: "tools",
    items: [
      "LLMs",
      "RAG Pipelines",
      "LangChain",
      "LangGraph",
      "MCP Servers",
      "Pipecat",
      "vLLM",
      "Hugging Face",
      "Pinecone",
      "FastAPI",
      "Postgres",
      "Redis",
      "Docker",
      "AWS (EC2, S3, RDS, SQS, Bedrock)",
      "Git",
      "GitHub",
      "Claude Code",
    ],
  },
];
