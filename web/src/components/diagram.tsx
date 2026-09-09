import { Brand, Icon } from "@/components/diagram-kit";
import { TONES } from "@/lib/theme";

function Arrow({ label, area }: { label: string; area: string }) {
  return (
    <div className={`dg-arrow dg-${area}`} aria-hidden>
      <span>{label}</span>
      <b>→</b>
    </div>
  );
}

function Down() {
  return (
    <div className="dg-down" aria-hidden>
      ↓
    </div>
  );
}

/** A full-width arrow between two bands. */
function Tail({ area }: { area: "a" | "b" }) {
  return (
    <div className={`dg-tail dg-tail-${area}`} aria-hidden>
      ↓
    </div>
  );
}

const STEPS: Array<[string, string]> = [
  ["promo_footprint", "greenlight_channel_mix"],
  ["global_trajectory", "rollout_global_trajectory"],
  ["country_footprint", "rollout_title_footprint"],
  ["reception", "dossier_reception"],
];

const TOOLSETS: Array<{
  group: string;
  note: string;
  tone: string;
  names: string[];
}> = [
  {
    group: "Read",
    note: "mcp-clickhouse",
    tone: "#c69a12",
    names: ["list_databases", "list_tables", "run_query"],
  },
  {
    group: "Build",
    note: "/mcp/dashboards",
    tone: "#8e4fa0",
    names: [
      "warehouse_overview",
      "preview_query",
      "read_panels",
      "list_dashboards",
      "get_dashboard",
      "create_dashboard",
      "update_dashboard",
      "delete_dashboard",
      "add_panel",
      "update_panel",
      "delete_panel",
    ],
  },
  {
    group: "Pitch",
    note: "/mcp/proposals",
    tone: "#0f7a74",
    names: [
      "list_proposals",
      "read_proposal",
      "create_proposal",
      "update_proposal",
      "adopt_panel",
      "add_proposal_panel",
      "delete_proposal_panel",
      "generate_still",
      "delete_proposal",
    ],
  },
];

const EVENTS = [
  "thought",
  "activity",
  "sql",
  "ran",
  "building",
  "built",
  "canvas",
  "proposal",
  "delta",
  "text",
];

export function DiagramFigure() {
  return (
    <figure className="diagram">
      <div className="dg">
        <section className="dg-box dg-src">
          <header>
            <Icon glyph="film" />
            <p className="kicker">Public sources</p>
          </header>
          <ul className="dg-rows">
            <li>
              <Brand src="netflix" label="Netflix Top 10" />
              <i>most popular · global · countries</i>
            </li>
            <li>
              <Brand src="imdb" label="IMDb" />
              <i>101.6M principals</i>
            </li>
            <li>
              <Icon glyph="table" />
              <b>MovieLens</b>
              <i>32M ratings</i>
            </li>
            <li>
              <Icon glyph="person" />
              <b>VOD clickstream</b>
              <i>671,736 sessions</i>
            </li>
          </ul>

          <Down />

          <div className="dg-sub-box">
            <Brand src="cloudstorage" label="gs://streamlens-data" />
          </div>

          <Down />

          <div className="dg-sub-box">
            <Brand src="clickhouse" label="17 ClickPipes" />
          </div>
        </section>

        <Arrow label="ingest" area="a1" />

        <section className="dg-box dg-yt">
          <header>
            <Brand src="youtube" label="YouTube Data API v3" />
          </header>
          <ul className="dg-rows">
            <li>
              <b>44 channels</b>
              <i>
                <code>TTL 30 DAY</code>
              </i>
            </li>
          </ul>
        </section>

        <section className="dg-host dg-ware">
          <header className="dg-hostbar">
            <Brand
              src="clickhouse"
              label="ClickHouse Cloud"
              note="service streamlens"
            />
          </header>

          <div className="dg-db">
            <p className="kicker">landing</p>
            <p>
              17 tables from the pipes
              <br />
              <b>267M rows</b> from ClickPipes
            </p>
          </div>

          <div className="dg-db">
            <p className="kicker">youtube</p>
            <p>
              57,659 videos, every row on a TTL
              <br />
              <b>192K rows</b>
              <br />
              <code>promo_top10_bridge</code>, hourly — 1,180 of 3,428 charting
              titles have a campaign to compare against
            </p>
          </div>

          <div className="dg-db">
            <p className="kicker">streamlens</p>
            <p>
              what the agent writes — <code>dashboard</code> ·{" "}
              <code>panel</code> · <code>proposal</code>
            </p>
          </div>
        </section>

        <Arrow label="SQL" area="a2" />

        <section className="dg-box dg-tools">
          <header>
            <Brand src="mcp" label="MCP toolsets" />
          </header>
          {TOOLSETS.map((set) => (
            <div
              key={set.group}
              className="dg-group"
              style={{ "--tone": set.tone } as React.CSSProperties}
            >
              <p className="kicker">
                {set.group} <i>{set.note}</i>
              </p>
              <ul>
                {set.names.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="dg-box dg-cloud">
          <header>
            <Brand
              src="googlecloud"
              label="Google Cloud"
              note="pctg-503822 · us-central1"
            />
          </header>

          <div
            className="dg-group"
            style={{ "--tone": "#4285f4" } as React.CSSProperties}
          >
            <Brand src="vertexai" label="Vertex AI" note="global endpoint" />
            <ul>
              <li>
                <Brand src="gemini" label="gemini-3.8-flash" />
              </li>
              <li>
                <Brand src="gemini" label="gemini-3-pro-image" />
              </li>
            </ul>
          </div>

          <div
            className="dg-group"
            style={{ "--tone": "#1a7f37" } as React.CSSProperties}
          >
            <Brand src="cloudrun" label="Cloud Run" />
            <ul>
              <li>
                <b>streamlens-web</b>
              </li>
              <li>
                <b>streamlens-api</b>
              </li>
              <li>
                <b>streamlens-clickhouse-mcp</b>
              </li>
            </ul>
          </div>

          <div
            className="dg-group"
            style={{ "--tone": "#c69a12" } as React.CSSProperties}
          >
            <Brand src="cloudstorage" label="Cloud Storage" />
            <ul>
              <li>
                <b>gs://streamlens-data</b>
              </li>
              <li>
                <b>gs://streamlens-proposals</b>
              </li>
            </ul>
          </div>

          <div
            className="dg-group"
            style={{ "--tone": "#5f6368" } as React.CSSProperties}
          >
            <Brand src="secretmanager" label="Secret Manager" />
            <ul>
              <li>
                <b>11 secrets</b>
                <i>ClickHouse and TMDB credentials</i>
              </li>
            </ul>
          </div>

          <div
            className="dg-group"
            style={{ "--tone": "#ea4335" } as React.CSSProperties}
          >
            <Brand src="adk" label="Agent Development Kit" />
            <ul>
              <li>
                <b>runner · sessions · MCP</b>
              </li>
            </ul>
          </div>

          <div
            className="dg-group"
            style={{ "--tone": "#8e4fa0" } as React.CSSProperties}
          >
            <Brand src="agentengine" label="Agent Engine" />
            <ul>
              <li>
                <b>Managed agent deployment</b>
              </li>
            </ul>
          </div>
        </section>

        <Tail area="a" />

        <section className="dg-host dg-serve">
          <header className="dg-hostbar">
            <Brand src="fastapi" label="FastAPI" />
            <span className="dg-plus">+</span>
            <Brand src="python" label="Python 3.11" note="uv" />
          </header>

          <div className="dg-serve-grid">
            <div className="dg-registry">
              <header>
                <Icon glyph="lock" tone="#c69a12" />
                <p className="kicker">
                  Named queries · <code>api/queries.py</code>
                </p>
              </header>
              <p className="dg-count">17</p>
              <p>
                The browser <b>names</b> a query and passes typed parameters
                that ClickHouse binds server-side. Every statement the product
                can run is in one file.
              </p>
              <p className="dg-flags">
                <span>greenlight_board</span>
                <span>rollout_weeks</span>
                <span>promo_cadence</span>
                <span>dossier_clips</span>
              </p>
            </div>

            <div className="dg-agent dg-agent-fixed">
              <header>
                <Icon glyph="shield" tone="#1a7f37" />
                <p className="kicker">Deterministic · greenlight</p>
              </header>
              <ol>
                {STEPS.map(([step, query]) => (
                  <li key={step}>
                    <i className="dg-plus">+</i>
                    <code>{step}</code>
                    <span>{query}</span>
                  </li>
                ))}
              </ol>
              <p className="dg-foot">
                Four queries, same order, every title — then Gemini synthesises.
                No figure in the brief can be invented, because the model never
                issues a query.
              </p>
            </div>

            <div className="dg-agent dg-agent-free">
              <header>
                <Icon glyph="plug" tone="#8e4fa0" />
                <p className="kicker">
                  Exploratory · <code>streamlens_analyst</code>
                </p>
              </header>
              <Brand
                src="adk"
                label="Google ADK"
                note="thinking MEDIUM · code sandbox · Search"
              />
              <p className="dg-foot">
                It authors SQL but never <i>serves</i> it. A panel&rsquo;s query
                is validated once when it is saved and replayed from storage
                thereafter, so no chart is drawn from something the model said
                this turn.
              </p>
            </div>
          </div>
        </section>

        <Tail area="b" />

        <section className="dg-host dg-web">
          <header className="dg-hostbar">
            <Brand src="nextjs" label="Next.js 16" note="App Router" />
            <span className="dg-plus">+</span>
            <Brand src="react" label="React 19" />
            <Brand src="typescript" label="TypeScript" />
          </header>

          <div className="dg-rooms">
            <div
              className="dg-room"
              style={{ "--tone": TONES.yellow } as React.CSSProperties}
            >
              <p className="kicker">/data</p>
              <p>
                <b>Greenlight Board</b> promo weight against the result
                <br />
                <b>Rollout Atlas</b> 94 countries, five years
                <br />
                <b>Promo Machine</b> cadence, Shorts mix, markets
              </p>
            </div>

            <div
              className="dg-room"
              style={{ "--tone": TONES.purple } as React.CSSProperties}
            >
              <p className="kicker">/studio</p>
              <p>
                <b>Rail</b> live ClickPipe state
                <br />
                <b>Canvas</b> twelve columns, 24 ECharts types
                <br />
                <b>Chat</b> the analyst, one turn at a time
              </p>
            </div>

            <div
              className="dg-room"
              style={{ "--tone": TONES.teal } as React.CSSProperties}
            >
              <p className="kicker">Streamed back</p>
              <p className="dg-flags">
                {EVENTS.map((event) => (
                  <span key={event}>{event}</span>
                ))}
              </p>
              <p className="dg-foot">
                One SSE stream from <code>POST /api/chat</code>.
              </p>
            </div>

            <div
              className="dg-room"
              style={{ "--tone": TONES.gray } as React.CSSProperties}
            >
              <p className="kicker">Title dossier</p>
              <p>One title across every source, with the brief on top.</p>
              <Brand src="tmdb" label="TMDB" note="artwork, proxied" />
            </div>
          </div>
        </section>
      </div>

      <figcaption>
        Two rules give the shape its edges. The browser never sends SQL — it
        names one of 17 queries and ClickHouse binds the parameters. And the
        model never serves SQL — it may author a query, but what draws a chart
        is always something already validated and stored.
      </figcaption>
    </figure>
  );
}
