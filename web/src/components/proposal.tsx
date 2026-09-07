"use client";

/**
 * A theme proposal on the canvas: a one-sheet, not a dashboard.
 *
 * Fetches `/api/mock/proposals/:id`. Marketplace panels come from the
 * live dashboard the proposal cites. Swap the mock prefix when a real
 * store lands.
 */

import { useEffect, useState } from "react";

import type { Dashboard } from "@/lib/api";
import { packRows } from "@/lib/layout";
import type { Proposal } from "@/lib/proposals";
import { PanelCard } from "@/components/panel";
import { useWorkspace } from "@/components/workspace";

function toneFor(genre: string): string {
  if (genre === "Comedy") return "green";
  if (genre === "Drama") return "blue";
  return "purple";
}

function MarketPanels({ dashboardId }: { dashboardId: string }) {
  const { revision } = useWorkspace();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    setDashboard(undefined);
    setError(undefined);
    fetch(`/api/dashboards/${dashboardId}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Dashboard>;
      })
      .then(setDashboard)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(String(e));
      });
    return () => ac.abort();
  }, [dashboardId, revision]);

  if (error) return <p className="report-market-wait">{error}</p>;
  if (!dashboard) {
    return <p className="report-market-wait">Loading warehouse charts…</p>;
  }
  if (dashboard.panels.length === 0) {
    return <p className="report-market-wait">No panels on this dashboard yet.</p>;
  }

  const panels = packRows(dashboard.panels);

  return (
    <div className="report-market-grid">
      {panels.map((panel) => (
        <PanelCard key={panel.id} panel={panel} reloadKey={revision} />
      ))}
    </div>
  );
}

export function ProposalView({ proposalId }: { proposalId: string }) {
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    setProposal(undefined);
    setError(undefined);
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
  if (!proposal) {
    return (
      <article className="report is-loading">
        <div className="report-hero" />
        <p className="canvas-waiting">Opening proposal…</p>
      </article>
    );
  }

  return (
    <article className={`report tone-${toneFor(proposal.genre)}`}>
      <header className="report-hero">
        <img src={proposal.still} alt="" />
        <div className="report-hero-veil" />
        <div className="report-hero-copy">
          <p className="report-kicker">Theme proposal</p>
          <h2>{proposal.title}</h2>
          <p className="report-hook">{proposal.hook}</p>
        </div>
      </header>

      <div className="report-slate">
        <span>{proposal.genre}</span>
        <span>{proposal.budget}</span>
        <span>{proposal.kicker}</span>
      </div>

      <blockquote className="report-logline">
        <p>{proposal.logline}</p>
      </blockquote>

      <section className="report-room">
        <h3>The room</h3>
        <p>{proposal.connection}</p>
      </section>

      <div className="report-grid">
        <section className="report-pane">
          <h3>The characters</h3>
          <div className="report-pane-body">
            <ul className="report-entries">
              {proposal.archetypes.map((person) => (
                <li key={person.name}>
                  <strong>{person.name}</strong>
                  <span>{person.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="report-pane">
          <h3>Story</h3>
          <div className="report-pane-body report-story">
            {proposal.story
              .split(/\n\n+/)
              .filter(Boolean)
              .map((para) => (
                <p key={para.slice(0, 24)}>{para}</p>
              ))}
          </div>
        </section>
      </div>

      <section className="report-market">
        <h3>The marketplace</h3>
        <p>{proposal.market}</p>
        <MarketPanels dashboardId={proposal.dashboard_id} />
      </section>
    </article>
  );
}
