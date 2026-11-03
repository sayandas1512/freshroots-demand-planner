import type { Metadata } from "next";
import { TourClient } from "./TourClient";
import "./tour.css";

export const metadata: Metadata = {
  title: "How it works · Freshroots",
  description: "A scroll-through of the Freshroots demand planner: from the day's files to line-by-line decisions, drafts and the kill switch.",
};

/** A public, static page: it explains the system with moving pictures and links into the live planner. */
export default function TourPage() {
  return <TourClient />;
}
