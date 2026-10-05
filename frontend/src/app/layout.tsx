import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { profile } from "@/content";
import { TerminalProvider } from "@/components/terminal/terminal-store";
import { Terminal } from "@/components/terminal/Terminal";
import { VoiceAssistant } from "@/components/voice/VoiceAssistant";
import { MotionProvider } from "@/components/MotionProvider";
import { CommandMenu } from "@/components/CommandMenu";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/* Display face for the name and section titles only. Its optical-size axis
   tightens the letterforms as they grow, which is what lets the hero name sit
   at poster size without looking like stretched body text. */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  axes: ["opsz", "wdth"],
});

const siteUrl = "https://portfolio.sahellx.site";
const description =
  "Sahil Khan — AI Engineer & Backend Developer. I build and ship production AI systems end-to-end: real-time voice agents, RAG pipelines, and self-hosted LLM infrastructure.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${profile.name} — ${profile.title}`,
    template: `%s — ${profile.name}`,
  },
  description,
  keywords: [
    "Sahil Khan",
    "AI Engineer",
    "Backend Developer",
    "LLM",
    "RAG",
    "vLLM",
    "FastAPI",
    "LangChain",
    "Voice Agents",
    "Next.js",
  ],
  authors: [{ name: profile.name }],
  creator: profile.name,
  alternates: { canonical: siteUrl },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: `${profile.name} — ${profile.title}`,
    description,
    siteName: `${profile.name} · Portfolio`,
  },
  twitter: {
    card: "summary_large_image",
    title: `${profile.name} — ${profile.title}`,
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0d" },
  ],
  colorScheme: "light dark",
};

/**
 * Applies a remembered theme choice before first paint, so a visitor who
 * picked dark never sees a white flash (and vice versa). No stored choice
 * means the CSS `prefers-color-scheme` rules decide.
 */
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${jetbrainsMono.variable} ${display.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-ink">
        <MotionProvider>
        <TerminalProvider>
          {children}
          <Terminal />
          <CommandMenu />
          {/* Inside the provider: the assistant can open the terminal on request. */}
          <VoiceAssistant />
        </TerminalProvider>
        </MotionProvider>
        <Analytics />
      </body>
    </html>
  );
}
