"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";

/** Page transition: a short cross-fade and a 12px rise. Re-mounts on every navigation. */
export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        gsap.from(ref.current, { opacity: 0, y: 12, duration: t.base, ease: t.easeOut, clearProps: "transform,opacity" });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return <div ref={ref}>{children}</div>;
}
