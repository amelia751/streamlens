"use client";

/**
 * The two warehouse cuts on one desk: a rail of sections, one pane in
 * front. Only the open section is mounted, so its charts measure against a
 * real width.
 */

import { useState, useTransition } from "react";

import { ErrorNote } from "@/components/shell";
import { TONES, type Tone } from "@/lib/theme";
import { fetchQuery, type Row } from "@/lib/api";

import { GreenlightBoard } from "./board";
import { RolloutAtlas } from "./atlas";
import { PromoMachine } from "./machine";
import type { DataView } from "./view";

type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export type GreenlightData = { board: Row[]; categories: string[] };
export type RolloutData = {
  rows: Row[];
  weeks: string[];
  week: string;
  category: string;
};
export type PromoData = { channels: Row[]; cadence: Row[]; campaigns: Row[] };

const SECTIONS: {
  id: DataView;
  tone: Tone;
  title: string;
  lede: string;
}[] = [
  {
    id: "titles",
    tone: "yellow",
    title: "By Title Performance",
    lede: "YouTube promo against Weekly Top 10 results, and where each title landed country by country.",
  },
  {
    id: "promo",
    tone: "green",
    title: "By Youtube Campaigns",
    lede: "What the 44 Netflix YouTube channels publish, where, and in what format.",
  },
];

function TitlePerformance({
  greenlight,
  rollout,
}: {
  greenlight: Loaded<GreenlightData>;
  rollout: Loaded<RolloutData>;
}) {
  const [pending, startTransition] = useTransition();
  const [week, setWeek] = useState(rollout.ok ? rollout.data.week : "");
  const [category, setCategory] = useState(
    rollout.ok ? rollout.data.category : "Films",
  );
  const [rows, setRows] = useState(rollout.ok ? rollout.data.rows : []);

  function go(next: { week?: string; category?: string }) {
    if (!rollout.ok) return;
    const nextWeek = next.week ?? week;
    const nextCategory = next.category ?? category;
    startTransition(async () => {
      try {
        const result = await fetchQuery("rollout_countries", {
          week: nextWeek,
          category: nextCategory,
          limit: 5000,
        });
        setRows(result.rows);
        setWeek(nextWeek);
        setCategory(nextCategory);
      } catch {
        // Keep the week that is already on screen.
      }
    });
  }

  return (
    <>
      {greenlight.ok ? (
        <GreenlightBoard
          board={greenlight.data.board}
          categories={greenlight.data.categories}
          reach={
            rollout.ok
              ? {
                  rows,
                  weeks: rollout.data.weeks,
                  week,
                  category,
                  pending,
                  onWeek: (w) => go({ week: w }),
                  onCategory: (c) => go({ category: c }),
                }
              : undefined
          }
        />
      ) : (
        <ErrorNote error={greenlight.error} />
      )}
      {rollout.ok ? (
        <RolloutAtlas
          rows={rows}
          week={week}
          category={category}
          pending={pending}
        />
      ) : (
        <ErrorNote error={rollout.error} />
      )}
    </>
  );
}

export function DataDesk({
  view: initial,
  greenlight,
  rollout,
  promo,
}: {
  view: DataView;
  greenlight: Loaded<GreenlightData>;
  rollout: Loaded<RolloutData>;
  promo: Loaded<PromoData>;
}) {
  const [view, setView] = useState(initial);
  const section = SECTIONS.find((s) => s.id === view) ?? SECTIONS[0];

  function select(next: DataView) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="data-desk">
      <aside className="rail data-rail" aria-label="Warehouse cuts">
        <div className="rail-panes">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`data-section${view === s.id ? " on" : ""}`}
              style={{ "--tone": TONES[s.tone] } as React.CSSProperties}
              aria-current={view === s.id ? "page" : undefined}
              onClick={() => select(s.id)}
            >
              <span className="data-section-title">{s.title}</span>
              <span className="data-section-lede">{s.lede}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="data-main">
        <div className="shell">
          <header className="page-head">
            <h1>{section.title}</h1>
            <p className="lede">{section.lede}</p>
          </header>

          {view === "titles" && (
            <TitlePerformance greenlight={greenlight} rollout={rollout} />
          )}

          {view === "promo" &&
            (promo.ok ? (
              <PromoMachine
                channels={promo.data.channels}
                cadence={promo.data.cadence}
                campaigns={promo.data.campaigns}
              />
            ) : (
              <ErrorNote error={promo.error} />
            ))}
        </div>
      </main>
    </div>
  );
}
