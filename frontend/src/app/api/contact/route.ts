import { NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const schema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(100),
  email: z.string().trim().max(160).regex(emailRe, "Please enter a valid email"),
  message: z.string().trim().min(1, "Please enter a message").max(3000),
  company: z.string().optional(), // honeypot — should stay empty
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid input.";
    return NextResponse.json({ error: first }, { status: 422 });
  }

  const { name, email, message, company } = parsed.data;

  // Honeypot: a bot filled the hidden field. Pretend success, send nothing.
  if (company && company.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email isn't configured yet. Please email me directly at s.sahil9752@gmail.com.",
      },
      { status: 503 }
    );
  }

  const to = process.env.CONTACT_TO_EMAIL || "s.sahil9752@gmail.com";
  const from =
    process.env.CONTACT_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      replyTo: email,
      subject: `Portfolio contact — ${name}`,
      text: `New message from your portfolio contact form\n\nName:  ${name}\nEmail: ${email}\n\n${message}\n`,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { error: "Could not send your message. Please try again later." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Contact route error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again later." },
      { status: 500 }
    );
  }
}
