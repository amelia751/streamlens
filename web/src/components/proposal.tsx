"use client";

/**
 * A theme proposal on the canvas: one page, stills, a warehouse chart.
 *
 * Fetches `/api/mock/proposals/:id`. Swap the prefix when a real store lands.
 */

import { useEffect, useState } from "react";

import { compact } from "@/lib/format";
import type { Proposal, ProposalChart } from "@/lib/proposals";
import { useWorkspace } from "@/components/workspace";

function chartValue(chart: ProposalChart, value: number): string {
  if (chart.format === "percent") return `${Math.round(value * 100)}%`;
  return compact(value);
}

function ProposalBars({ chart }: { chart: ProposalChart }) {
  const { openDashboard } = useWorkspace();
  const max = Math.max(...chart.bars.map((bar) => bar.value), 1);

  return (
    <figure className={`report-chart tone-${chart.tone}`}>
      <figcaption>
        <button
          type="button"
          className="report-chart-dash"
          onClick={() => openDashboard(chart.dashboard_id, chart.dashboard_title)}
        >
          {chart.dashboard_title}
        </button>
        <strong>{chart.title}</strong>
        <span>{chart.caption}</span>
      </figcaption>
      <ul>
        {chart.bars.map((bar) => (
          <li key={bar.label}>
            <span className="report-chart-label">{bar.label}</span>
            <span className="report-chart-track" aria-hidden>
              <i style={{ width: `${Math.max((bar.value / max) * 100, 4)}%` }} />
            </span>
            <span className="report-chart-value">
              {chartValue(chart, bar.value)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function ProposalView({ proposalId }: { proposalId: string }) {
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/mock/proposals/${proposalId}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Proposal>;
      })
      .then(setProposal)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(String(e));
      });
    return () => ac.abort();
  }, [proposalId]);

  if (error) return <p className="canvas-error">{error}</p>;
  if (!proposal) return <p className="canvas-waiting">Opening proposal…</p>;

  return (
    <article className="report">
      <header className="report-banner">
        <p className="report-kicker">Theme proposal</p>
        <h2>{proposal.title}</h2>
        <p>{proposal.hook}</p>
      </header>

      <div className="report-page">
        <div className="report-col is-copy">
          <div className="report-strip">
            <img src={proposal.still} alt="" />
            <div className="report-strip-meta">
              <strong>{proposal.title}</strong>
              <span>Budget — {proposal.budget}</span>
              <span>Genre — {proposal.genre}</span>
            </div>
          </div>

          <section>
            <h3>Personal connection</h3>
            <p>{proposal.connection}</p>
          </section>
          <section>
            <h3>Logline</h3>
            <p className="report-lead">{proposal.logline}</p>
          </section>
          <section>
            <h3>The characters</h3>
            <ul className="report-cast">
              {proposal.archetypes.map((person) => (
                <li key={person.name}>
                  <strong>{person.name}</strong>
                  <span>{person.note}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Where we meet them</h3>
            <p>{proposal.meet}</p>
          </section>
        </div>

        <div className="report-col is-beats">
          <section>
            <h3>Story</h3>
            <ol className="report-beats">
              {proposal.beats.map((beat) => (
                <li key={beat.label}>
                  <strong>{beat.label}</strong>
                  <p>{beat.text}</p>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3>Where we leave them</h3>
            <p>{proposal.leave}</p>
          </section>
          <section>
            <h3>The marketplace</h3>
            <p>{proposal.market}</p>
            {proposal.charts.map((chart) => (
              <ProposalBars key={chart.title} chart={chart} />
            ))}
          </section>
        </div>
      </div>
    </article>
  );
}
