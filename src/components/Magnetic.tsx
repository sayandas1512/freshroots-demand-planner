"use client";

import { useEffect } from "react";
import { gsap } from "@/lib/gsap";

/**
 * Primary buttons lean toward the pointer as it nears them and spring back when it leaves. Off for touch, for reduced
 * motion, and for automated browsers (so tests click a button that is standing still).
 */
export function Magnetic() {
  useEffect(() => {
    if (navigator.webdriver || window.matchMedia("(pointer: coarse), (prefers-reduced-motion: reduce)").matches) return;
    let current: HTMLElement | null = null;
    const release = (el: HTMLElement) => gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.45)", overwrite: true });
    const onMove = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.(".btn-primary:not(:disabled)") as HTMLElement | null;
      if (current && current !== target) release(current);
      current = target;
      if (!target) return;
      const r = target.getBoundingClientRect();
      gsap.to(target, { x: (e.clientX - (r.left + r.width / 2)) * 0.22, y: (e.clientY - (r.top + r.height / 2)) * 0.32, duration: 0.35, ease: "power3.out", overwrite: true });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (current) release(current);
    };
  }, []);
  return null;
}
