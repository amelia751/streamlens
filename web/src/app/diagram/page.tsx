import type { Metadata } from "next";

import { DiagramFigure } from "@/components/diagram";

export const metadata: Metadata = {
  title: "How it is put together",
  description:
    "Public sources into ClickHouse Cloud, read by a Gemini agent on Google Cloud, drawn by Next.js.",
};

export default function DiagramPage() {
  return (
    <div className="shell diagram-page">
      <header className="page-head">
        <p className="kicker">Appendix</p>
        <h1>How it is put together</h1>
        <p className="lede">
          Two platforms and one warehouse. Everything a chart shows came from a
          query someone can read.
        </p>
      </header>

      <DiagramFigure />
    </div>
  );
}
