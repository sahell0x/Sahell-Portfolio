export interface Education {
  school: string;
  degree: string;
  period: string;
  cgpa: string;
}

export interface Stat {
  value: string;
  label: string;
}

export interface Profile {
  name: string;
  handle: string;
  title: string;
  roles: string[];
  tagline: string;
  location: string;
  availability: string;
  bio: string[];
  email: string;
  phone: string;
  resumeUrl: string;
  education: Education;
  stats: Stat[];
}

export const profile: Profile = {
  name: "Sahil Khan",
  handle: "sahell0x",
  title: "AI Engineer & Backend Developer",
  roles: [
    "AI Engineer",
    "Backend Developer",
    "LLM Infra Engineer",
    "RAG Systems Builder",
  ],
  tagline:
    "I build and ship production AI systems end-to-end — real-time voice agents, RAG pipelines, and self-hosted LLM infrastructure.",
  location: "Indore, India",
  availability: "Open to opportunities",
  bio: [
    "I'm a software engineer working at the intersection of AI and backend systems. Right now I'm building a high-throughput, “true natural” voice-agent platform at Purple Sky Infotech — orchestrating STT/TTS engines and LLM APIs to hold real conversations at sub-second latency.",
    "I'm drawn to the hard parts: self-hosting open-source LLMs on GPUs with vLLM, cutting inference cost without sacrificing latency, and building RAG systems that stay fast over hundreds of thousands of document chunks. I care about systems that are correct, observable, and cheap to run.",
  ],
  email: "s.sahil9752@gmail.com",
  phone: "+91 9752588937",
  resumeUrl: "https://resume.sahell.in",
  education: {
    school: "Jawaharlal Institute of Technology, Vidhya Vihar, Borawan",
    degree: "B.E. in Electronics & Communication Engineering",
    period: "Graduated 2025",
    cgpa: "7.34 / 10",
  },
  stats: [
    { value: "sub-200ms", label: "RAG query latency over 100k+ chunks" },
    { value: "40%", label: "LLM inference cost cut with vLLM" },
    { value: "60%+", label: "increase in concurrent active calls" },
    { value: "100k+", label: "document chunks served in RAG" },
  ],
};
