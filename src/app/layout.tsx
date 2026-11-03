import type { Metadata } from "next";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./tokens.css";
import "./base.css";
import "./review.css";
import "./pages.css";
import "./chat.css";
import "./visual.css";
import { Magnetic } from "@/components/Magnetic";
import { Spotlight } from "@/components/Spotlight";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Twice-weekly SKU reorder recommendations from documented rules, reviewed line by line.",
};

const THEME_SCRIPT = `document.documentElement.setAttribute('data-theme','dark');try{var t=localStorage.getItem('fr-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Spotlight />
        <Magnetic />
      </body>
    </html>
  );
}
