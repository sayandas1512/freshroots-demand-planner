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
