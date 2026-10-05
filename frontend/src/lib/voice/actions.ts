/**
 * Executes the page actions the assistant requests, and answers for them.
 *
 * These run as RPC handlers, so each one returns the sentence the agent hears
 * back and speaks around. That is also why validation lives here rather than on
 * the server: this side is the one that knows what is actually on the page, and
 * a rejected argument comes back as something the model can recover from.
 *
 * Kept apart from the React components so the transport layer doesn't need to
 * know about the DOM, and so each action can be reasoned about on its own.
 */
import { profile } from "@/content";
import { KAIRA_NAVIGATED } from "./bus";
import {
  PAGE_SECTIONS,
  type PageActionName,
  type PageActionPayload,
  type PageSection,
} from "./types";

const SECTION_IDS: Record<PageSection, string> = {
  about: "about",
  experience: "experience",
  skills: "skills",
  projects: "projects",
  contact: "contact",
};

/** What the agent hears back. Short and factual — it gets spoken around, not read out. */
const ACKS: Record<PageActionName, string> = {
  show_section: "Done — that section is now on screen.",
  open_terminal: "Done — the terminal is open.",
  download_resume: "Done — the resume download has started.",
  open_contact_form: "Done — the contact form is open.",
};

export interface ActionHandlers {
  /** Opens the site's interactive terminal. */
  openTerminal: (command?: string) => void;
}

/** Raised for a hallucinated argument, so the agent can correct itself out loud. */
export class PageActionError extends Error {}

function isSection(value: string): value is PageSection {
  return (PAGE_SECTIONS as readonly string[]).includes(value);
}

function scrollToSection(section: PageSection) {
  const element = document.getElementById(SECTION_IDS[section]);
  if (!element) return;

  // `smooth` respects prefers-reduced-motion in every modern engine.
  element.scrollIntoView({ behavior: "smooth", block: "start" });
  // Let the page mark where Kaira took the visitor.
  window.dispatchEvent(new CustomEvent(KAIRA_NAVIGATED, { detail: { section } }));
}

function downloadResume() {
  const link = document.createElement("a");
  link.href = profile.resumeUrl;
  link.download = "sahil_khan_resume.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function openContactForm() {
  scrollToSection("contact");
  // Focus after the smooth scroll settles, so the browser doesn't jump.
  window.setTimeout(() => {
    const field = document.getElementById("name");
    if (field instanceof HTMLInputElement) field.focus({ preventScroll: true });
  }, 700);
}

/**
 * Runs one page action and returns the agent's confirmation.
 *
 * @throws {PageActionError} if the arguments don't name something real.
 */
export function runPageAction(
  action: PageActionName,
  payload: PageActionPayload,
  handlers: ActionHandlers,
): string {
  switch (action) {
    case "show_section": {
      const raw = typeof payload.section === "string" ? payload.section.trim().toLowerCase() : "";
      if (!isSection(raw)) {
        throw new PageActionError(
          `Unknown section "${raw}"; expected one of ${PAGE_SECTIONS.join(", ")}.`,
        );
      }
      scrollToSection(raw);
      return ACKS.show_section;
    }
    case "open_terminal":
      handlers.openTerminal();
      return ACKS.open_terminal;
    case "download_resume":
      downloadResume();
      return ACKS.download_resume;
    case "open_contact_form":
      openContactForm();
      return ACKS.open_contact_form;
    default:
      throw new PageActionError(`Unknown page action "${action}".`);
  }
}
