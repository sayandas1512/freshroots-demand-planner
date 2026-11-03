"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

// All plugins ship in the installed gsap package (verified at install: Flip, ScrollTrigger, SplitText, DrawSVGPlugin).
gsap.registerPlugin(useGSAP, Flip, ScrollTrigger, SplitText, DrawSVGPlugin);

export { gsap, useGSAP, Flip, ScrollTrigger, SplitText };

// Development only: lets the browser console reach GSAP (for example to switch off lag smoothing in a slow, throttled preview).
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") Object.assign(window, { __gsap: gsap, __ScrollTrigger: ScrollTrigger });
