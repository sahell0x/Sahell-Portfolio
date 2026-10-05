// Single source of truth for all site content.
// Both the readable page and the interactive terminal import from here,
// so the two views can never drift out of sync.
export { profile } from "./profile";
export type { Profile, Education, Stat } from "./profile";

export { skillGroups } from "./skills";
export type { SkillGroup } from "./skills";

export { experience } from "./experience";
export type { Job } from "./experience";

export { projects } from "./projects";
export type { Project } from "./projects";

export { socials } from "./socials";
export type { Social } from "./socials";

export const nav = [
  { label: "about", href: "#about" },
  { label: "experience", href: "#experience" },
  { label: "skills", href: "#skills" },
  { label: "projects", href: "#projects" },
  { label: "contact", href: "#contact" },
] as const;
