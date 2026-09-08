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
import { proposalLink } from "@/lib/links";
import type { DashboardSummary } from "@/lib/api";
import type { Proposal, ProposalPanel } from "@/lib/proposals";
import { PanelCard, PanelPlaceholder } from "@/components/panel";
import { Connecting } from "@/components/spinner";
import { useWorkspace, type Build } from "@/components/workspace";

/** A chart the analyst is adding, holding its cell. See `dashboard.tsx`. */
type Pending = { id: string; width: number; height: number; build: Build };

type Cell = ProposalPanel | Pending;

function isPending(cell: Cell): cell is Pending {
  return "build" in cell;
}

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
  const { building, working } = useWorkspace();

  // Charts on their way onto this proposal. A pitch is read top to bottom, so
  // the space for them is held open while their queries run rather than the
  // section growing under the reader — and held until the chart itself is in
  // the document, not just saved. Packed with the finished ones, so a chart
  // landing does not re-share the row it is landing in.
  const here = new Set(proposal.panels.map((p) => p.id));
  const arriving = building.filter(
    (b) =>
      b.kind === "panel" &&
      b.proposalId === proposal.id &&
      !(b.landed && here.has(b.landed)),
  );

  if (proposal.panels.length === 0 && arriving.length === 0) {
    return working ? (
      <p className="report-market-wait is-working">
        The analyst is working. Charts appear here as they are made.
      </p>
    ) : (
      <p className="report-market-wait">
        No chart on this proposal yet — the argument above is still an idea.
      </p>
    );
  }

  const cells = packRows<Cell>([
    ...proposal.panels,
    ...arriving.map((b) => ({
      id: b.token,
      width: b.width ?? 6,
      height: b.height ?? 1,
      build: b,
    })),
  ]);

  return (
    <div className="report-market-grid">
      {cells.map((cell) =>
        isPending(cell) ? (
          <PanelPlaceholder
            key={cell.id}
            title={cell.build.title}
            chart={cell.build.chart}
            width={cell.width}
            height={cell.height}
          />
        ) : (
          <PanelCard
            key={cell.id}
            panel={cell}
            dataUrl={`/api/proposals/${proposal.id}/panels/${cell.id}`}
            reference={proposalLink(proposal.id, cell.id)}
            reloadKey={`${cell.query}|${JSON.stringify(cell.spec)}`}
          />
        ),
      )}
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
  const { building } = useWorkspace();
  // Which URL failed, rather than a boolean — so switching proposals clears
  // the failure by comparison instead of by an effect that resets it.
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const url = proposal.still_url;
  const broken = url !== null && brokenUrl === url;

  // The still is the slowest thing the analyst makes — twenty seconds of
  // image model — and the gradient it replaces looks finished. Saying so is
  // the difference between waiting and thinking there is nothing to wait for.
  const coming = building.some(
    (b) => b.kind === "still" && b.proposalId === proposal.id,
  );

  return (
    <header
      className={`report-hero${!url || broken ? " is-blank" : ""}${
        coming ? " is-building" : ""
      }`}
      aria-busy={coming || undefined}
    >
      {url && !broken && (
        <img src={url} alt="" onError={() => setBrokenUrl(url)} />
      )}
      <div className="report-hero-veil" />
      {coming && <p className="report-hero-flag">generating the still</p>}
      <div className="report-hero-copy">
        <p className="report-kicker">Theme proposal</p>
        <h2>{proposal.title}</h2>
        <p className="report-hook">{proposal.hook}</p>
      </div>
    </header>
  );
}

export function ProposalView({ proposalId }: { proposalId: string }) {
  const { revision } = useWorkspace();
  // One piece of state, so a reload replaces the old document and the old
  // error together. Never cleared: the canvas gives each proposal its own
  // component, so a refetch here is always this proposal changing under us —
  // a chart being adopted, a still finishing — and the page it is replacing is
  // a better thing to show meanwhile than a spinner.
  const [state, setState] = useState<{ proposal?: Proposal; error?: string }>({});
  const { proposal, error } = state;

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/proposals/${proposalId}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Proposal>;
      })
      .then((body) => setState({ proposal: body }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ error: String(e) });
      });
    return () => ac.abort();
  }, [proposalId, revision]);

  if (error) return <p className="canvas-error">{error}</p>;
  if (!proposal) return <Connecting />;

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
