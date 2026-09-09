/**
 * The problem, as three slides.
 *
 * Each slide is a drawing over a structured caption, in the same box-and-arrow
 * language as `/diagram`: bordered cards, a red arrow for every handoff, and
 * the real column names rather than a paraphrase of them.
 *
 * The illustrations are flat PNGs on white. They sit on a tinted band and
 * blend with `multiply`, so the drawing's background disappears into the tint
 * instead of sitting on a visible white rectangle.
 */

/** The relay a question makes today, from the devpost. */
const DESKS = [
  "Filmmaker",
  "Strategy & Analysis",
  "Marketing",
  "Finance",
  "Content executives",
  "Greenlight",
];

/** The join keys are the real ones, and no two of them match. */
const SOURCES: Array<{
  mark?: string;
  label: string;
  note: string;
  key: string;
}> = [
  {
    mark: "netflix",
    label: "Platform Top 10",
    note: "what charted",
    key: "show_title",
  },
  {
    mark: "youtube",
    label: "YouTube",
    note: "what was promoted",
    key: "video_id",
  },
  { mark: "imdb", label: "IMDb", note: "cast and crew", key: "tconst" },
  { mark: "tmdb", label: "TMDB", note: "artwork and genre", key: "tmdb_id" },
  { label: "MovieLens", note: "taste and tags", key: "movieId" },
  { label: "Clickstream", note: "sessions", key: "movie_id" },
];

function Mark({ src }: { src?: string }) {
  if (!src) {
    return (
      <svg className="pb-glyph" viewBox="0 0 24 24" aria-hidden>
        <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
        <path d="M3.4 9.4h17.2M3.4 14.4h17.2M9.6 9.4v10" />
      </svg>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/diagram/${src}.svg`} alt="" width={18} height={18} />;
}

function Art({
  src,
  alt,
  tone,
  callout,
}: {
  src: string;
  alt: string;
  tone?: "warm";
  /** A speech bubble pinned over the drawing, positioned per illustration. */
  callout?: string;
}) {
  return (
    <figure className={tone ? `pb-art pb-art-${tone}` : "pb-art"}>
      <div className="pb-art-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/problem/${src}.png`} alt={alt} />
        {callout ? <p className="pb-callout">{callout}</p> : null}
      </div>
    </figure>
  );
}

export function ProblemDeck() {
  return (
    <div className="shell problem-page">
      <header className="page-head">
        <p className="kicker">The problem</p>
        <h1>The signals exist. Nothing joins them.</h1>
        <p className="lede">
          Streaming is an allocation problem — budget, marketing, channels,
          markets — and the person with the idea is the furthest from the
          numbers that would settle it.
        </p>
      </header>

      <section className="pb-slide">
        <header className="pb-head">
          <p className="kicker">Today</p>
          <h2>A question crosses five desks before it meets the evidence.</h2>
        </header>

        <ol className="pb-chain">
          {DESKS.map((desk) => (
            <li key={desk}>
              <span>{desk}</span>
            </li>
          ))}
        </ol>

        <Art
          src="relay"
          alt="A filmmaker at one end of a row of desks, a document passed from desk to desk."
          callout="I think there is an opportunity here."
        />
      </section>

      <section className="pb-slide">
        <header className="pb-head">
          <p className="kicker">And the evidence</p>
          <h2>Six sources, six owners, no shared key.</h2>
        </header>

        <Art
          src="fragments"
          alt="Six jigsaw pieces of different shapes, scattered apart and unable to interlock."
        />

        <div className="pb-islands">
          {SOURCES.map((source) => (
            <div key={source.label} className="pb-island">
              <header>
                <Mark src={source.mark} />
                <b>{source.label}</b>
              </header>
              <i>{source.note}</i>
              <code>{source.key}</code>
            </div>
          ))}
        </div>

        <p className="pb-note">
          The one that says what actually charted is a title string. Joining
          them is the work.
        </p>
      </section>

      <section className="pb-slide">
        <header className="pb-head">
          <p className="kicker">Streamlens</p>
          <h2>Trend analytics and evidence-backed theme proposal platform</h2>
        </header>

        <Art
          src="unified"
          alt="A filmmaker in conversation with a single stack of unified data."
          tone="warm"
        />

        <div className="pb-flow">
          <div className="pb-node">
            <header>
              <b>Data sources</b>
            </header>
            <span className="pb-marks" aria-hidden>
              {SOURCES.map((source) => (
                <Mark key={source.label} src={source.mark} />
              ))}
            </span>
          </div>

          <b className="pb-arrow" aria-hidden>
            →
          </b>

          <div className="pb-node">
            <header>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/diagram/clickhouse.svg" alt="" width={18} height={18} />
              <b>ClickHouse</b>
            </header>
            <i>high-performance OLAP database</i>
          </div>

          <b className="pb-arrow" aria-hidden>
            →
          </b>

          <div className="pb-node">
            <header>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/diagram/gemini.svg" alt="" width={18} height={18} />
              <b>Gemini</b>
            </header>
            <i>reads it in plain language, cites the query</i>
          </div>

          <b className="pb-arrow pb-arrow-both" aria-hidden>
            ⇄
          </b>

          <div className="pb-node pb-node-person">
            <header>
              <svg className="pb-glyph" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="8" r="3.4" />
                <path d="M5.5 19.6c1.3-3.5 3.6-5.2 6.5-5.2s5.2 1.7 6.5 5.2" />
              </svg>
              <b>Filmmaker</b>
            </header>
            <i>asks, and asks again</i>
          </div>
        </div>
      </section>
    </div>
  );
}
