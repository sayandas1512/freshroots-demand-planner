import type { Metadata } from "next";
import { Familjen_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./tokens.css";
import "./base.css";
import "./review.css";
import "./pages.css";

const head = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-familjen", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Twice-weekly SKU reorder recommendations from documented rules, reviewed line by line.",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem('fr-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${head.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
