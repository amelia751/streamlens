"use client";

/**
 * A theme proposal on the canvas: a one-sheet, not a dashboard.
 *
 * The charts under "The marketplace" are the proposal's own — copies of
 * panel definitions, fetched with the document and replayed from
 * `/api/proposals/:id/panels/:panelId`. Nothing here fetches the dashboard
 * a chart was adopted from, which is exactly why deleting that dashboard
 * cannot collapse this report.
 *
 * Provenance is the one place the dashboard is mentioned, and it is a
 * label. It becomes a link only when that dashboard happens to still
 * exist, and quietly stops being one when it does not.
 */

import { useEffect, useState } from "react";

import { packRows } from "@/lib/layout";
import type { DashboardSummary } from "@/lib/api";
import type { Proposal } from "@/lib/proposals";
import { PanelCard } from "@/components/panel";
import { Connecting } from "@/components/spinner";
import { useWorkspace } from "@/components/workspace";

/**
 * The genre colours the whole page, so the vocabulary here has to match
 * the closed set validated in `proposals/spec.py`. Anything unrecognised
 * lands on purple rather than on nothing.
 */
function toneFor(genre: string): string {
  switch (genre) {
    case "Comedy":
    case "Family":
      return "green";
    case "Drama":
    case "Romance":
      return "blue";
    case "Documentary":
    case "Animation":
      return "teal";
    case "Action":
    case "Crime":
      return "yellow";
    default:
      return "purple";
  }
}

/**
 * Whether the dashboard a proposal cites is still there.
 *
 * Deliberately the *list* route, not the dashboard itself: this decides
 * whether to render a link, and nothing about the report depends on the
 * answer. A failed fetch means no link, never an error.
 */
function useDashboardLives(dashboardId: string): boolean {
  const [lives, setLives] = useState(false);

  useEffect(() => {
    if (!dashboardId) return;
    let dropped = false;
    fetch("/api/dashboards")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (dropped || !body) return;
        setLives(
          (body.dashboards ?? []).some(
            (d: DashboardSummary) => d.id === dashboardId,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [dashboardId]);

  return lives;
}

function Provenance({ proposal }: { proposal: Proposal }) {
  const { openDashboard } = useWorkspace();
  const lives = useDashboardLives(proposal.source_dashboard_id);
  const title = proposal.source_dashboard_title;

  if (!title) return null;

  return (
    <p className="report-provenance">
      Adapted from{" "}
      {lives ? (
        <button
          type="button"
          onClick={() =>
            openDashboard(proposal.source_dashboard_id, title)
          }
        >
          {title}
        </button>
      ) : (
        <span>{title}</span>
      )}
      . The queries are this proposal&rsquo;s own copies, replayed live.
    </p>
  );
}

function MarketPanels({ proposal }: { proposal: Proposal }) {
  const { revision } = useWorkspace();

  if (proposal.panels.length === 0) {
    return (
      <p className="report-market-wait">
        No chart on this proposal yet — the argument above is still an idea.
      </p>
    );
  }

  const panels = packRows(proposal.panels);

  return (
    <div className="report-market-grid">
      {panels.map((panel) => (
        <PanelCard
          key={panel.id}
          panel={panel}
          dataUrl={`/api/proposals/${proposal.id}/panels/${panel.id}`}
          reloadKey={revision}
        />
      ))}
    </div>
  );
}

/**
 * The still, or the tone gradient standing in for it.
 *
 * Image generation can be blocked or simply never run, and a still row can
 * outlive its object. All three cases land here as the same thing: a
 * coloured field, never a broken `<img>`.
 */
function Hero({ proposal }: { proposal: Proposal }) {
  // Which URL failed, rather than a boolean — so switching proposals clears
  // the failure by comparison instead of by an effect that resets it.
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const url = proposal.still_url;
  const broken = url !== null && brokenUrl === url;

  return (
    <header className={`report-hero${!url || broken ? " is-blank" : ""}`}>
      {url && !broken && (
        <img src={url} alt="" onError={() => setBrokenUrl(url)} />
      )}
      <div className="report-hero-veil" />
      <div className="report-hero-copy">
        <p className="report-kicker">Theme proposal</p>
        <h2>{proposal.title}</h2>
        <p className="report-hook">{proposal.hook}</p>
      </div>
    </header>
  );
}

export function ProposalView({ proposalId }: { proposalId: string }) {
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    setProposal(undefined);
    setError(undefined);
    fetch(`/api/proposals/${proposalId}`, { signal: ac.signal })
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
    return <Connecting label="Connecting to ClickHouse instance" />;
  }

  return (
    <article className={`report tone-${toneFor(proposal.genre)}`}>
      <Hero proposal={proposal} />

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
          <h3>Theme</h3>
          <div className="report-pane-body report-theme">
            {proposal.theme
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
        <Provenance proposal={proposal} />
        <MarketPanels proposal={proposal} />
      </section>

      <footer className="report-foot">
        <span>Figures computed by Streamlens from the warehouse, live.</span>
        {proposal.stills.length > 0 && (
          <span>
            Still generated with {proposal.stills[0].model}; carries a SynthID
            watermark.
          </span>
        )}
      </footer>
    </article>
  );
}
