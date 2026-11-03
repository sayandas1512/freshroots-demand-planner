"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { AppWindow } from "./AppWindow";

const STEPS = [
  { t: "The day's files arrive", d: "Sales, stock, SKUs, distributors and the festival calendar are read row by row. A bad row is rejected with its reason; the rest still load." },
  { t: "The rules decide", d: "Documented rules turn weeks of cover and demand trends into an action and a quantity. The same data always gives the same answer." },
  { t: "Odd ones go to Raghav", d: "A SKU whose sales jump tenfold is not guessed at. It becomes an exception for a person's judgment." },
  { t: "The model only words it", d: "Gemini explains each decision in plain language. Every number in its text must exist in the facts, or the fixed wording is used." },
  { t: "Raghav approves every line", d: "Approve, edit with a reason, or reject with a reason. Every override is logged. Nothing moves until a person decides." },
  { t: "Drafts, never orders", d: "Approved lines export as a CSV or become draft purchase orders in Zoho. Only a person can issue one, in Zoho." },
  { t: "A kill switch you can trust", d: "If outcomes get worse than the baseline, the system stops itself, sends an alert, and stays read-only until the sponsor clears it with a note." },
];

const PRINCIPLES = [
  { h: "Rules decide. The model words.", p: "The action and the quantity come from rules anyone can read. The language model only explains them, and its text is checked in code before it is shown.", icons: ["M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.6 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.6-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z", "M21 12a8 8 0 01-11.8 7L3 21l2-5.2A8 8 0 1121 12z"] },
  { h: "A person approves every line.", p: "Line by line, with a reason for every edit or rejection. The override log shows who changed what, and why.", icons: ["M5 12l5 5L20 7"] },
  { h: "Drafts, never orders.", p: "Zoho receives draft purchase orders, once, never duplicated. Issuing one stays a human act that this system cannot perform.", icons: ["M6 3h8l4 4v14H6z", "M9 13h6M9 17h4"] },
  { h: "Built to be stopped.", p: "A kill switch anyone can press, kill criteria the sponsor owns, alert emails, and a log of every stop and every clear.", icons: ["M12 3l9 16H3z", "M12 10v4M12 17h.01"] },
];

const PAGES: { label: string; href: string; d: string; tone?: "accent" }[] = [
  { label: "Open the planner", href: "/", d: "M5 12h14M13 6l6 6-6 6", tone: "accent" },
  { label: "Review", href: "/", d: "M4 6h16M4 12h16M4 18h10" },
  { label: "Settings", href: "/settings", d: "M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4" },
  { label: "Data", href: "/data", d: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  { label: "Outcomes", href: "/outcomes", d: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { label: "Zoho", href: "/zoho", d: "M6 3h8l4 4v14H6zM9 13h6M9 17h4" },
  { label: "Health", href: "/health", d: "M3 12h4l3-8 4 16 3-8h4" },
  { label: "Backtest", href: "/backtest", d: "M3 12a9 9 0 109-9M3 4v5h5M12 7v5l3 2" },
  { label: "Compare", href: "/compare", d: "M8 4v16M16 4v16M4 8h8M12 16h8" },
];

const FAQ = [
  { q: "Do I need to sign in?", a: "No. Open access is on, so the link opens straight onto the working system and you act as a guest administrator: you can run, approve, export and use the kill switch. It is for demonstration, so please do not put real data in it." },
  { q: "Does it place orders?", a: "No. It recommends. Approved lines can be downloaded as a CSV for procurement or created as draft purchase orders in Zoho, and a person still issues them there. The connector has no code path that issues an order." },
  { q: "Where do the numbers come from?", a: "From the case's own files: weekly sales, SKU master, distributors, current stock and the festival calendar. The rules are the ones Raghav documented, and every threshold is on the Settings page." },
  { q: "What does the language model do?", a: "It writes the plain-language reason for each line and the three-line headline, from numbers the rules already computed. It never chooses an action or a quantity." },
  { q: "What if the model fails or makes something up?", a: "Every number in its text must appear in the facts it was given, and it may not name a different action. Anything that fails is replaced by fixed wording, the run still completes, and an alert is sent." },
  { q: "How do I try the kill switch?", a: "Open Outcomes and upload the demo files in fixtures/, then press Run the kill check on Health. A first bad batch warns, the next stops the system. Clear it from Health with a note." },
];

/** Replace every number in the reason with a span the story can tick off one by one. */
function markNumbers(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?%?)/g, '<span class="n">$1</span>');
}

export function TourClient() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(0);

  useGSAP(
    () => {
      const el = root.current as HTMLElement;
      const mm = gsap.matchMedia();

      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          wide: "(min-width: 900px)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        (ctx) => {
          const { motion, wide, reduce } = ctx.conditions as { motion: boolean; wide: boolean; reduce: boolean };
          const cleanups: (() => void)[] = []; // ctx.add() would run these now, so they are returned instead and run on revert
          const q = gsap.utils.selector(el);
          const heroWin = q(".w-hero")[0] as HTMLElement;
          const storyWin = q(".w-story")[0] as HTMLElement;
          const sq = gsap.utils.selector(storyWin);

          // numbers in the reason become spans, in both windows, before anything animates
          const reasonEl = sq(".w-reason-text")[0] as HTMLElement;
          reasonEl.innerHTML = markNumbers(reasonEl.dataset.full ?? "");

          // ---------- the story's steps list ----------
          const steps = q(".t-step") as HTMLElement[];
          const setStep = (i: number) => steps.forEach((s, n) => s.classList.toggle("is-on", n === i));
          setStep(0);

          if (reduce) {
            // No movement: the finished picture, and every step readable.
            gsap.set(sq(".w-view-data"), { opacity: 0 });
            gsap.set(sq(".w-view-review"), { opacity: 1 });
            gsap.set(sq(".w-st-pending")[0] as Element, { opacity: 0 });
            gsap.set(sq(".w-st-approved")[0] as Element, { opacity: 1 });
            gsap.set(sq(".w-export"), { opacity: 1 });
            gsap.set(sq(".w-decided"), { textContent: 1 });
            gsap.set(sq(".w-export-n"), { textContent: 1 });
            steps.forEach((s) => s.classList.add("is-on"));
            return;
          }
          if (!motion) return;

          // ---------- hero: copy reveal, drifting light, and the window that rises into place ----------
          const split = SplitText.create(q(".t-hero h1")[0] as HTMLElement, { type: "words", mask: "words" });
          gsap
            .timeline({ defaults: { ease: "expo.out" } })
            .from(q(".t-hero .t-eyebrow"), { y: 16, opacity: 0, duration: 0.8 })
            .from(split.words, { yPercent: 115, duration: 1.1, stagger: 0.07 }, 0.1)
            .from(q(".t-sub, .t-cta, .t-note"), { y: 24, opacity: 0, duration: 0.9, stagger: 0.1 }, 0.55)
            .from(q(".t-nav"), { y: -30, opacity: 0, duration: 0.9 }, 0);

          q(".t-orb").forEach((orb, i) => gsap.to(orb, { x: i % 2 ? -50 : 60, y: i === 1 ? 50 : -40, duration: 9 + i * 2, ease: "sine.inOut", yoyo: true, repeat: -1 }));
          if (wide) {
            const hero = q(".t-hero")[0] as HTMLElement;
            const orbs = q(".t-orb");
            const moves = orbs.map((o, i) => ({ x: gsap.quickTo(o, "xPercent", { duration: 1.6, ease: "power3.out" }), y: gsap.quickTo(o, "yPercent", { duration: 1.6, ease: "power3.out" }), k: (i + 1) * 4 }));
            const onMove = (e: PointerEvent) => {
              const nx = e.clientX / window.innerWidth - 0.5;
              const ny = e.clientY / window.innerHeight - 0.5;
              moves.forEach((m) => { m.x(nx * m.k); m.y(ny * m.k); });
            };
            hero.addEventListener("pointermove", onMove);
            cleanups.push(() => hero.removeEventListener("pointermove", onMove));
          }

          gsap.set(heroWin, { rotateX: 16, scale: 0.84, y: 60, opacity: 0.85 });
          gsap.to(heroWin, { rotateX: 0, scale: 1, y: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: q(".t-stage")[0], start: "top 95%", end: "top 22%", scrub: 0.6 } });
          gsap.to(q(".t-hero-copy"), { y: -50, opacity: 0.3, ease: "none", scrollTrigger: { trigger: q(".t-stage")[0], start: "top 70%", end: "top 8%", scrub: 0.6 } });

          // the finished review settles in as the window arrives: gauges fill, pins pop, cover figures count up
          const hq = gsap.utils.selector(heroWin);
          const settle = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
          settle
            .from(hq(".w-row"), { y: 22, opacity: 0, stagger: 0.07, duration: 0.6 })
            .from(hq(".w-fill"), { scaleX: 0, stagger: 0.07, duration: 1.1 }, 0.2)
            .from(hq(".w-marker"), { scale: 0, stagger: 0.07, duration: 0.5, ease: "back.out(2.2)" }, 0.9)
            .from(hq(".w-chip"), { scale: 0.6, opacity: 0, stagger: 0.04, duration: 0.4 }, 0.6);
          hq(".w-cover").forEach((c) => {
            const to = Number((c as HTMLElement).dataset.to);
            const o = { v: 0 };
            settle.to(o, { v: to, duration: 1.2, ease: "power2.out", onUpdate: () => { c.textContent = o.v.toFixed(1); } }, 0.2);
          });
          ScrollTrigger.create({ trigger: q(".t-stage")[0], start: "top 62%", once: true, onEnter: () => settle.play() });

          // ---------- the story ----------
          const inner = q(".t-story-pin")[0] as HTMLElement; // the full-width wrapper is what gets pinned, so the centred grid inside keeps its margins
          const tl = gsap.timeline({ defaults: { ease: "power2.out" }, paused: !wide });
          buildStory(tl, storyWin, sq);
          const total = tl.duration();

          if (wide) {
            ScrollTrigger.create({
              trigger: inner,
              start: "top top",
              end: "+=560%",
              pin: true,
              anticipatePin: 1,
              scrub: 0.8,
              animation: tl,
              invalidateOnRefresh: true,
              onUpdate: (self) => setStep(Math.min(STEPS.length - 1, Math.floor(self.progress * total * 0.9999))),
            });
          } else {
            // phones: no pinning; the story plays by itself while it is on screen
            tl.repeat(-1).repeatDelay(1.6).timeScale(0.28);
            tl.eventCallback("onUpdate", () => setStep(Math.min(STEPS.length - 1, Math.floor(tl.time()))));
            ScrollTrigger.create({ trigger: inner, start: "top 75%", end: "bottom 15%", onEnter: () => tl.play(), onEnterBack: () => tl.play(), onLeave: () => tl.pause(), onLeaveBack: () => tl.pause() });
          }

          // ---------- sections that reveal as they arrive ----------
          q(".t-sec h2, .t-end h2").forEach((h) => {
            const sp = SplitText.create(h as HTMLElement, { type: "words", mask: "words" });
            gsap.from(sp.words, { yPercent: 110, duration: 1, stagger: 0.05, ease: "expo.out", scrollTrigger: { trigger: h, start: "top 85%", once: true } });
          });
          ScrollTrigger.batch(q(".t-card"), { start: "top 88%", once: true, onEnter: (b) => gsap.from(b, { y: 50, opacity: 0, duration: 0.9, stagger: 0.12, ease: "power3.out" }) });
          ScrollTrigger.batch(q(".t-q"), { start: "top 92%", once: true, onEnter: (b) => gsap.from(b, { y: 24, opacity: 0, duration: 0.7, stagger: 0.08, ease: "power3.out" }) });
          gsap.from(q(".t-dock a"), { y: 60, opacity: 0, duration: 0.8, stagger: 0.06, ease: "back.out(1.6)", scrollTrigger: { trigger: q(".t-dock")[0], start: "top 90%", once: true } });
          gsap.from(q(".t-end .btn, .t-end small"), { y: 30, opacity: 0, duration: 0.9, stagger: 0.1, ease: "power3.out", scrollTrigger: { trigger: q(".t-end")[0], start: "top 75%", once: true } });

          // ---------- the dock: icons swell as the pointer nears ----------
          if (wide && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
            const dock = q(".t-dock")[0] as HTMLElement;
            const items = q(".t-dock a") as HTMLElement[];
            const set = items.map((a) => ({ s: gsap.quickTo(a, "scale", { duration: 0.28, ease: "power3.out" }), y: gsap.quickTo(a, "y", { duration: 0.28, ease: "power3.out" }) }));
            const onMove = (e: PointerEvent) =>
              items.forEach((a, i) => {
                const r = a.getBoundingClientRect();
                const k = Math.max(0, 1 - Math.abs(e.clientX - (r.left + r.width / 2)) / 150) ** 2;
                set[i]?.s(1 + 0.8 * k);
                set[i]?.y(-16 * k);
              });
            const onLeave = () => set.forEach((x) => { x.s(1); x.y(0); });
            dock.addEventListener("pointermove", onMove);
            dock.addEventListener("pointerleave", onLeave);
            cleanups.push(() => { dock.removeEventListener("pointermove", onMove); dock.removeEventListener("pointerleave", onLeave); });
          }
          return () => cleanups.forEach((fn) => fn());
        },
      );
      return () => mm.revert();
    },
    { scope: root },
  );

  function toggle(i: number) {
    const next = open === i ? null : i;
    const panels = root.current?.querySelectorAll<HTMLElement>(".t-a");
    panels?.forEach((p, n) => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(p, { height: n === next ? "auto" : 0, duration: reduce ? 0 : 0.45, ease: "power3.inOut" });
    });
    setOpen(next);
  }

  return (
    <div className="t-root" ref={root}>
      <header className="t-nav">
        <Link href="/tour" className="brand" aria-label="Freshroots, how it works">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 5-3 8-8 7z" /><path d="M12 15c0-3-2-5-6-5 0 4 2 6 6 5z" /></svg>
          Freshroots
        </Link>
        <nav className="t-links" aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#principles">Principles</a>
          <a href="#pages">The pages</a>
          <a href="#faq">Questions</a>
        </nav>
        <Link href="/" className="btn btn-primary btn-sm">Open the planner</Link>
      </header>

      <main>
        <section className="t-hero">
          <div className="t-orbs" aria-hidden="true"><i className="t-orb t-orb-a" /><i className="t-orb t-orb-b" /><i className="t-orb t-orb-c" /></div>
          <div className="t-hero-copy">
            <p className="t-eyebrow">Freshroots demand planner</p>
            <h1>Know what to reorder, <em>and why.</em></h1>
            <p className="t-sub">Raghav&apos;s reorder rules, run twice a week and explained line by line. A person approves every line, and nothing is ordered until they do.</p>
            <div className="t-cta">
              <Link href="/" className="btn btn-primary">Open the planner</Link>
              <a href="#how" className="btn">See how a run works</a>
            </div>
            <p className="t-note">Open access · no sign-in · demonstration data</p>
          </div>
          <div className="t-stage"><AppWindow variant="hero" /></div>
        </section>

        <section className="t-story" id="how" aria-labelledby="how-h">
          <div className="t-story-pin">
           <div className="t-story-inner">
            <div className="t-steps">
              <p className="t-eyebrow">How a run works</p>
              <h2 id="how-h">One run, from files to <em className="serif-em">decision.</em></h2>
              <ol>
                {STEPS.map((s) => (
                  <li key={s.t} className="t-step"><b>{s.t}</b><p>{s.d}</p></li>
                ))}
              </ol>
            </div>
            <div className="t-story-stage"><AppWindow variant="story" /></div>
           </div>
          </div>
        </section>

        <section className="t-sec" id="principles" aria-labelledby="pr-h">
          <p className="t-eyebrow">What it will not do</p>
          <h2 id="pr-h">Careful by design.</h2>
          <div className="t-cards">
            {PRINCIPLES.map((c) => (
              <article key={c.h} className="card t-card">
                <div className="t-icons">
                  {c.icons.map((d, i) => (
                    <span key={i} className="t-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg></span>
                  ))}
                </div>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="t-sec" id="pages" aria-labelledby="pg-h">
          <p className="t-eyebrow">Everything is one click away</p>
          <h2 id="pg-h">Eight pages. All live.</h2>
          <div className="t-dock-wrap">
            <nav className="t-dock" aria-label="The planner's pages">
              {PAGES.map((p) => (
                <Link key={p.label} href={p.href} data-tone={p.tone} aria-label={p.label}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.d} /></svg>
                  <span>{p.label}</span>
                </Link>
              ))}
            </nav>
          </div>
          <p className="t-dock-note">Hover the dock, then pick a page.</p>
        </section>

        <section className="t-sec" id="faq" aria-labelledby="fq-h">
          <p className="t-eyebrow">Questions</p>
          <h2 id="fq-h">Before you start.</h2>
          <div className="t-faq">
            {FAQ.map((f, i) => (
              <div key={f.q} className="t-q" data-open={open === i}>
                <button type="button" aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => toggle(i)}>
                  {f.q}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                <div className="t-a" id={`faq-${i}`} role="region" style={{ height: i === 0 ? "auto" : 0 }}><p>{f.a}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="t-end">
          <h2>Try it <em className="serif-em">yourself.</em></h2>
          <Link href="/" className="btn btn-primary">Open the planner</Link>
          <small>Run for 2026-10-19, the date the data is built for.</small>
        </section>
      </main>
    </div>
  );
}

/** The whole run as one timeline: seven chapters of one unit each, so the scroll position maps straight onto the steps. */
function buildStory(tl: gsap.core.Timeline, win: HTMLElement, q: gsap.utils.SelectorFunc) {
  const winRect = () => win.getBoundingClientRect();
  /** Where the centre of an element is, in the window's own coordinates. Read when the tween starts, so it follows resizes. */
  const at = (el: Element, dx = 0, dy = 0) => {
    const w = winRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - w.left + r.width / 2 + dx, y: r.top - w.top + r.height / 2 + dy };
  };
  const rows = q(".w-row:not(.w-row-exc)") as HTMLElement[];
  const exc = q(".w-row-exc")[0] as HTMLElement;
  const cursor = q(".w-cursor")[0] as HTMLElement;
  const ripple = q(".w-ripple")[0] as HTMLElement;
  const explain = q(".w-explain")[0] as HTMLElement;
  const review = q(".w-view-review")[0] as HTMLElement;

  // 0 · the files arrive
  const countEl = q("[data-count]")[0] as HTMLElement;
  tl.from(q(".w-file"), { y: -90, opacity: 0, rotate: (i: number) => [-5, 4, -3, 5, -4][i] ?? 0, stagger: 0.1, duration: 0.3 }, 0)
    .to(q(".w-file-bar span"), { scaleX: 1, stagger: 0.09, duration: 0.3 }, 0.25)
    .to(q(".w-file-ok"), { opacity: 1, stagger: 0.09, duration: 0.15 }, 0.45)
    .fromTo(countEl, { textContent: 0 }, { textContent: 255, duration: 0.45, ease: "none", snap: { textContent: 1 } }, 0.3); // value tweens render when the scrub jumps; onUpdate callbacks do not

  // 1 · the rules decide
  tl.to(q(".w-view-data"), { opacity: 0, y: -24, duration: 0.2 }, 1)
    .set(review, { opacity: 1 }, 1.05)
    .from(q(".w-view-review .w-head, .w-strip"), { y: 18, opacity: 0, duration: 0.2, stagger: 0.05 }, 1.05)
    .from(rows, { y: 24, opacity: 0, stagger: 0.06, duration: 0.2 }, 1.2)
    .from(q(".w-row:not(.w-row-exc) .w-fill"), { scaleX: 0, stagger: 0.06, duration: 0.35 }, 1.3)
    .from(q(".w-row:not(.w-row-exc) .w-marker"), { scale: 0, stagger: 0.06, duration: 0.25, ease: "back.out(2)" }, 1.45)
    .from(q(".w-row:not(.w-row-exc) .w-chip"), { scale: 0.6, opacity: 0, stagger: 0.04, duration: 0.2 }, 1.5);
  (q(".w-cover") as HTMLElement[]).forEach((c) => {
    tl.fromTo(c, { textContent: 0 }, { textContent: Number(c.dataset.to), duration: 0.45, ease: "none", snap: { textContent: 0.1 } }, 1.3);
  });

  // 2 · an odd SKU goes to Raghav
  tl.fromTo(exc, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.25 }, 2.05)
    .fromTo(exc, { boxShadow: "0 0 0 0px rgba(172,154,245,0)" }, { boxShadow: "0 0 0 5px rgba(172,154,245,.28)", duration: 0.2, yoyo: true, repeat: 1 }, 2.3)
    .fromTo(q(".w-exc-count"), { textContent: 0 }, { textContent: 1, duration: 0.01, snap: { textContent: 1 } }, 2.55)
    .fromTo(q(".w-exc-count"), { scale: 1 }, { scale: 1.6, duration: 0.1, yoyo: true, repeat: 1 }, 2.55);

  // 3 · the model words it, and every number is checked
  const reason = q(".w-reason-text")[0] as HTMLElement;
  const chars = SplitText.create(reason, { type: "chars" }).chars;
  gsap.set(chars, { opacity: 0 });
  tl.to(exc, { opacity: 0, duration: 0.1 }, 2.98)
    .to(review, { opacity: 0.22, filter: "blur(2px)", duration: 0.15 }, 3)
    .fromTo(explain, { opacity: 0, y: 22, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.15 }, 3.05)
    .to(chars, { opacity: 1, stagger: { each: 0.0019 }, duration: 0.01, ease: "none" }, 3.15)
    .to(q(".w-src .s-t"), { opacity: 0, duration: 0.05 }, 3.55)
    .to(q(".w-src .s-l"), { opacity: 1, duration: 0.05 }, 3.55)
    .to(q(".w-reason-text .n"), { className: "+=ok", stagger: 0.04, duration: 0.01 }, 3.58)
    .to(q(".w-verify"), { opacity: 1, duration: 0.05 }, 3.62)
    .from(q(".w-v-item"), { opacity: 0, y: 8, stagger: 0.03, duration: 0.08 }, 3.62)
    .fromTo(q(".w-bad"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.12 }, 3.82)
    .to(explain, { opacity: 0, y: -12, duration: 0.1 }, 3.97)
    .to(review, { opacity: 1, filter: "blur(0px)", duration: 0.12 }, 3.97);

  // 4 · Raghav approves and rejects
  const st = (i: number) => rows[i]?.querySelector(".w-status") as HTMLElement;
  tl.set(cursor, { x: () => winRect().width * 0.8, y: () => winRect().height * 0.18 }, 4)
    .to(cursor, { opacity: 1, duration: 0.05 }, 4)
    .to(cursor, { x: () => at(st(0)).x, y: () => at(st(0)).y, duration: 0.25, ease: "power2.inOut" }, 4.05)
    .fromTo(ripple, { scale: 0.3, opacity: 1 }, { scale: 1.7, opacity: 0, duration: 0.18 }, 4.32)
    .to(rows[0]?.querySelector(".w-st-pending") as Element, { opacity: 0, duration: 0.05 }, 4.33)
    .to(rows[0]?.querySelector(".w-st-approved") as Element, { opacity: 1, duration: 0.1 }, 4.33)
    .fromTo(q(".w-decided"), { textContent: 0 }, { textContent: 1, duration: 0.01, snap: { textContent: 1 } }, 4.4)
    .fromTo(q(".w-export-n"), { textContent: 0 }, { textContent: 1, duration: 0.01, snap: { textContent: 1 } }, 4.4)
    .to(q(".w-export"), { opacity: 1, duration: 0.12 }, 4.4)
    .to(q(".w-progress i"), { scaleX: 0.2, duration: 0.15 }, 4.4)
    .to(cursor, { x: () => at(st(1)).x, y: () => at(st(1)).y, duration: 0.22, ease: "power2.inOut" }, 4.55)
    .fromTo(ripple, { scale: 0.3, opacity: 1 }, { scale: 1.7, opacity: 0, duration: 0.18 }, 4.78)
    .to(rows[1]?.querySelector(".w-st-pending") as Element, { opacity: 0, duration: 0.05 }, 4.79)
    .to(rows[1]?.querySelector(".w-st-rejected") as Element, { opacity: 1, duration: 0.1 }, 4.79)
    .fromTo(q(".w-decided"), { textContent: 1 }, { textContent: 2, duration: 0.01, snap: { textContent: 1 } }, 4.85)
    .to(q(".w-progress i"), { scaleX: 0.4, duration: 0.15 }, 4.85)
    .to(cursor, { x: () => at(q(".w-export")[0] as Element).x, y: () => at(q(".w-export")[0] as Element).y, duration: 0.2, ease: "power2.inOut" }, 5);

  // 5 · drafts, never orders
  tl.fromTo(ripple, { scale: 0.3, opacity: 1 }, { scale: 1.7, opacity: 0, duration: 0.18 }, 5.22)
    .fromTo(q(".w-csv"), { opacity: 0, y: 30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.2 }, 5.28)
    .fromTo(q(".w-po"), { opacity: 0, x: 70, rotate: 3 }, { opacity: 1, x: 0, rotate: 0, duration: 0.3, ease: "back.out(1.4)" }, 5.5)
    .fromTo(q(".w-stamp"), { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.14, ease: "power4.in" }, 5.78)
    .to(q(".w-issue"), { opacity: 1, duration: 0.1 }, 5.9);

  // 6 · the kill switch
  tl.to([q(".w-po")[0], q(".w-csv")[0], cursor], { opacity: 0, duration: 0.1 }, 6)
    .to(review, { opacity: 0, duration: 0.12 }, 6)
    .to(q(".w-view-health"), { opacity: 1, duration: 0.12 }, 6.05)
    .fromTo(q(".w-spark"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.4, ease: "none" }, 6.1)
    .to(q(".w-dot")[0] as Element, { opacity: 1, duration: 0.05 }, 6.38)
    .to(q(".w-dot-2")[0] as Element, { opacity: 1, duration: 0.05 }, 6.5)
    .fromTo(q(".w-banner"), { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.15 }, 6.5)
    .to(win, { filter: "saturate(.3) brightness(.92)", duration: 0.18 }, 6.55)
    .to(win, { filter: "saturate(1) brightness(1)", duration: 0.12 }, 6.86)
    .to(q(".w-banner"), { opacity: 0, y: -10, duration: 0.1 }, 6.86)
    .fromTo(q(".w-clear"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.12 }, 6.9);

  tl.set({}, {}, 7); // pad to exactly seven units
}
