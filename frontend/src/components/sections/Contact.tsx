"use client";

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { profile } from "@/content";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Rail } from "@/components/ui/Rail";
import { Reveal } from "@/components/ui/Reveal";

type Status = "idle" | "loading" | "success" | "error";
type Field = "name" | "email" | "message";
type Errors = Partial<Record<Field, string>>;

/* Mirrors the server's schema in app/api/contact/route.ts, so a visitor sees
   what is wrong beside the field instead of after a round trip. The server
   still validates; this is courtesy, not trust. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validate(form: Record<Field, string>): Errors {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = "Please enter your name";
  if (!EMAIL_RE.test(form.email.trim())) errors.email = "Please enter a valid email";
  if (!form.message.trim()) errors.message = "Please enter a message";
  return errors;
}

/**
 * The address is the call to action, so it is set as one: display-size, with
 * an underline that draws on hover and a copy button that confirms in place.
 */
function EmailLine({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.location.href = `mailto:${email}`;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
      <a
        href={`mailto:${email}`}
        className="group relative font-display text-[clamp(1.6rem,5.2vw,3.25rem)] leading-tight font-semibold tracking-[-0.03em] break-all text-ink"
      >
        {email}
        <span className="absolute inset-x-0 -bottom-1 h-[2px] origin-right scale-x-0 bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:origin-left group-hover:scale-x-100" />
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Email copied" : "Copy email address"}
        className="relative flex h-11 items-center gap-2 overflow-hidden rounded-full border border-edge-strong px-4 text-sm text-dim transition-colors hover:border-ink hover:text-ink"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={copied ? "done" : "copy"}
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}


export function Contact() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [form, setForm] = useState({
    name: "",
    email: "",
    message: "",
    company: "", // honeypot
  });

  const update =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      // Typing into a flagged field is the fix in progress; stop shouting.
      setErrors((prev) => {
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field as Field];
        return next;
      });
    };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    const first = (Object.keys(found) as Field[])[0];
    if (first) {
      setStatus("idle");
      document.getElementById(first)?.focus();
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || "Something went wrong. Please email me directly.",
        );
      }
      setStatus("success");
      setForm({ name: "", email: "", message: "", company: "" });
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const inputClass =
    "w-full rounded-lg border bg-surface px-3.5 py-3 text-[0.9375rem] text-ink outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-faint focus:bg-bg";
  const validClass =
    "border-edge hover:border-edge-strong focus:border-ink focus:shadow-[0_0_0_3px_var(--select)]";
  const labelClass = "mb-2 block text-sm text-dim";
  const invalidClass =
    "border-danger hover:border-danger focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]";

  /* Wiring every field shares: the invalid style, and the message linked to
     the control so a screen reader reads it with the label. */
  const fieldProps = (field: Field) => ({
    id: field,
    name: field,
    value: form[field],
    onChange: update(field),
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${field}-error` : undefined,
    className: `${inputClass} ${field === "message" ? "resize-y" : ""} ${errors[field] ? invalidClass : validClass}`,
  });
  const fieldError = (field: Field) =>
    errors[field] && (
      <p id={`${field}-error`} className="mt-1.5 text-sm text-danger">
        {errors[field]}
      </p>
    );

  return (
    <Section id="contact">
      <SectionHeading
        title="Let's talk"
        blurb="Building something with AI, or need a backend that scales? Send me a note."
      />

      <Reveal className="mb-16 sm:mb-20">
        <EmailLine email={profile.email} />
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="text-faint">Phone</dt>
            <dd>
              <a
                href={`tel:${profile.phone.replace(/\s/g, "")}`}
                className="text-ink underline decoration-edge-strong underline-offset-4 transition-colors hover:decoration-ink"
              >
                {profile.phone}
              </a>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-faint">Based in</dt>
            <dd className="text-ink">{profile.location}</dd>
          </div>
        </dl>
      </Reveal>

      <Reveal delay={0.05}>
        <Rail
          aside={
            <p className="font-display text-lg font-semibold tracking-tight text-ink">Or write here</p>
          }
        >
          <form onSubmit={onSubmit} noValidate>
            {status === "success" ? (
              <div className="rounded-lg border border-edge bg-surface p-6">
                <p className="text-ink">Message sent.</p>
                <p className="mt-1 text-sm text-dim">
                  Thanks for reaching out — I&apos;ll get back to you soon.
                </p>
                <button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="mt-4 text-sm text-dim underline underline-offset-2 hover:text-ink"
                >
                  Send another
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className={labelClass}>
                      Name
                    </label>
                    <input
                      {...fieldProps("name")}
                      required
                      maxLength={100}
                      placeholder="Ada Lovelace"
                      autoComplete="name"
                    />
                    {fieldError("name")}
                  </div>
                  <div>
                    <label htmlFor="email" className={labelClass}>
                      Email
                    </label>
                    <input
                      {...fieldProps("email")}
                      type="email"
                      required
                      maxLength={160}
                      placeholder="you@company.com"
                      autoComplete="email"
                    />
                    {fieldError("email")}
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className={labelClass}>
                    Message
                  </label>
                  <textarea
                    {...fieldProps("message")}
                    required
                    rows={5}
                    maxLength={3000}
                    placeholder="Tell me about your project or role…"
                  />
                  {fieldError("message")}
                </div>

                {/* honeypot — hidden from humans */}
                <input
                  type="text"
                  name="company"
                  value={form.company}
                  onChange={update("company")}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden"
                />

                {status === "error" && (
                  <p className="text-sm text-danger" role="alert">
                    {errorMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-bg transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === "loading" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {status === "loading" ? "Sending…" : "Send message"}
                </button>
              </div>
            )}
          </form>
        </Rail>
      </Reveal>
    </Section>
  );
}
