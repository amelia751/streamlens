import type { Metadata } from "next";

import { ProblemDeck } from "@/components/problem";

export const metadata: Metadata = {
  title: "The problem",
  description:
    "The signals exist and nothing joins them, so the person with the idea is furthest from the evidence.",
};

export default function ProblemPage() {
  return <ProblemDeck />;
}
