"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BarList, DataTable, Panel, RankLine, Stat, Stats } from "@/components/charts";
import {
  compact,
  commas,
  fetchArtwork,
  fetchQuery,
  num,
  str,
  type TitleArtwork,
} from "@/lib/api";

export function TitleDialog({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const [art, setArt] = useState<TitleArtwork | null>(null);
  const [artReady, setArtReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [trajectory, setTrajectory] = useState<Record<string, unknown>[]>([]);
  const [footprint, setFootprint] = useState<Record<string, unknown>[]>([]);
  const [clips, setClips] = useState<Record<string, unknown>[]>([]);
  const [mix, setMix] = useState<Record<string, unknown>[]>([]);
  const [reception, setReception] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setArt(null);
    setArtReady(false);
    setDataReady(false);
    setError(null);
    setTrajectory([]);
    setFootprint([]);
    setClips([]);
    setMix([]);
    setReception([]);

    fetchArtwork(title)
      .then((a) => {
        if (!cancelled) setArt(a);
      })
      .catch(() => {
        /* Hero keeps the title we already have. */
      })
      .finally(() => {
        if (!cancelled) setArtReady(true);
      });

    Promise.all([
      fetchQuery("rollout_global_trajectory", { title }),
      fetchQuery("rollout_title_footprint", { title }),
      fetchQuery("dossier_clips", { title, limit: 40 }),
      fetchQuery("greenlight_channel_mix", { title }),
      fetchQuery("dossier_reception", { title }),
    ])
      .then(([t, f, c, m, r]) => {
        if (cancelled) return;
        setTrajectory(t.rows);
        setFootprint(f.rows);
        setClips(c.rows);
        setMix(m.rows);
        setReception(r.rows);
        setDataReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [title]);

  const bestRank = Math.min(...trajectory.map((r) => num(r.rank)), 99);
  const hours = trajectory.reduce((s, r) => s + num(r.hours_viewed), 0);
  const imdb = reception[0];
  const meta = [
    art?.year,
    art?.media_type === "tv" ? "TV" : art?.media_type === "movie" ? "Film" : null,
    art?.vote_average ? `TMDB ${Number(art.vote_average).toFixed(1)}` : null,
    imdb ? `IMDb ${num(imdb.average_rating).toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AnimatePresence>
      <motion.div
        className="td-scrim"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="td-sheet"
          aria-busy={!dataReady && !error}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type="button"
            className="td-close pill"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>

          <header className="td-hero">
            {art?.backdrop_url ? (
              // Public TMDB CDN. The API token never reaches the browser.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="td-backdrop" src={art.backdrop_url} alt="" />
            ) : null}
            <div className="td-hero-fade">
              <div
                className={`td-poster${
                  !artReady && !art?.poster_url ? " is-waiting" : ""
                }`}
              >
                {art?.poster_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={art.poster_url} alt="" />
                ) : artReady ? (
                  <span aria-hidden>{title.slice(0, 1)}</span>
                ) : null}
              </div>
              <div className="td-hero-copy">
                <h2>{art?.title || title}</h2>
                {artReady ? (
                  meta ? <p className="td-meta">{meta}</p> : null
                ) : (
                  <div className="td-hero-skel" aria-hidden>
                    <span className="td-bone" style={{ width: "9.5rem" }} />
                    <span
                      className="td-bone"
                      style={{ width: "min(22rem, 92%)", height: "0.7rem" }}
                    />
                    <span
                      className="td-bone"
                      style={{ width: "min(18rem, 78%)", height: "0.7rem" }}
                    />
                  </div>
                )}
                {art?.overview ? (
                  <p className="td-overview">{art.overview}</p>
                ) : null}
              </div>
            </div>
          </header>

          <div className="td-body" aria-busy={!dataReady && !error}>
            {error && <p className="note">{error}</p>}
            {!error && (
              <>
                {dataReady ? (
                  <Stats>
                    <Stat
                      label="Best global rank"
                      value={bestRank < 99 ? `#${bestRank}` : "—"}
                    />
                    <Stat
                      label="Weeks charted"
                      value={commas(trajectory.length)}
                    />
                    <Stat label="Hours viewed" value={compact(hours)} />
                    <Stat
                      label="Countries"
                      value={commas(footprint.length)}
                    />
                    <Stat
                      label="IMDb"
                      value={
                        imdb ? `${num(imdb.average_rating).toFixed(1)}` : "—"
                      }
                      hint={
                        imdb
                          ? `${compact(imdb.num_votes)} votes`
                          : "no exact title match"
                      }
                    />
                  </Stats>
                ) : (
                  <StatSkeleton />
                )}

                {dataReady ? (
                  <>
                    <div className="mb-5 grid gap-4 lg:grid-cols-3">
                      <Panel
                        className="lg:col-span-2"
                        title="Global rank trajectory"
                        subtitle="Higher on the chart is a better rank. Yellow marks a week at #1."
                      >
                        <RankLine
                          points={trajectory.map((r) => ({
                            week: str(r.week),
                            rank: num(r.rank),
                            hours: num(r.hours_viewed),
                          }))}
                          height={220}
                        />
                      </Panel>
                      <Panel
                        title="Promo footprint"
                        subtitle="Channels that carried this title."
                      >
                        <BarList
                          tone="purple"
                          data={mix.slice(0, 10).map((r) => ({
                            label: str(r.channel),
                            value: num(r.clips),
                            note: str(r.market),
                          }))}
                          format="raw"
                          emptyLabel="No promo clips matched this title."
                        />
                      </Panel>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel
                        title="Country footprint"
                        subtitle="Best rank and weeks in each country."
                      >
                        <DataTable
                          rows={footprint.slice(0, 80)}
                          columns={[
                            { key: "country_name", label: "Country" },
                            {
                              key: "best_rank",
                              label: "Best",
                              align: "right",
                              render: (r) =>
                                num(r.best_rank) === 1 ? (
                                  <span className="chip">#1</span>
                                ) : (
                                  `#${num(r.best_rank)}`
                                ),
                            },
                            {
                              key: "weeks_present",
                              label: "Weeks",
                              align: "right",
                            },
                          ]}
                          empty="This title did not chart in any country cut."
                        />
                      </Panel>
                      <Panel
                        title="Promo clips"
                        subtitle="Newest first. Retained 30 days."
                      >
                        <DataTable
                          rows={clips}
                          columns={[
                            {
                              key: "video_title",
                              label: "Clip",
                              render: (r) => (
                                <a
                                  href={`https://www.youtube.com/watch?v=${str(r.video_id)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="title-link block max-w-[16rem] truncate"
                                >
                                  {str(r.video_title)}
                                </a>
                              ),
                            },
                            { key: "market", label: "Market" },
                            {
                              key: "is_short",
                              label: "Format",
                              render: (r) =>
                                num(r.is_short) ? "Short" : "Long",
                            },
                          ]}
                          empty="No promo clips matched this title."
                        />
                      </Panel>
                    </div>
                  </>
                ) : (
                  <ChartSkeleton />
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const STAT_SKEL = [
  "Best global rank",
  "Weeks charted",
  "Hours viewed",
  "Countries",
  "IMDb",
] as const;

function StatSkeleton() {
  return (
    <dl className="stats" aria-hidden>
      {STAT_SKEL.map((label) => (
        <div key={label} className="stat">
          <dt className="stat-label">{label}</dt>
          <div className="td-bone-ink td-bone-value" />
        </div>
      ))}
    </dl>
  );
}

function ChartSkeleton() {
  return (
    <>
      <div className="mb-5 grid gap-4 lg:grid-cols-3" aria-hidden>
        <div className="panel lg:col-span-2">
          <div className="panel-head">
            <h2>Global rank trajectory</h2>
            <p>Higher on the chart is a better rank. Yellow marks a week at #1.</p>
          </div>
          <div className="td-bone-ink td-bone-chart" />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Promo footprint</h2>
            <p>Channels that carried this title.</p>
          </div>
          <div className="space-y-2.5">
            {[88, 72, 64, 51, 40].map((w) => (
              <div key={w} className="td-bone-ink" style={{ height: "1.35rem", width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <div className="panel">
          <div className="panel-head">
            <h2>Country footprint</h2>
            <p>Best rank and weeks in each country.</p>
          </div>
          <div className="td-bone-ink td-bone-table" />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Promo clips</h2>
            <p>Newest first. Retained 30 days.</p>
          </div>
          <div className="td-bone-ink td-bone-table" />
        </div>
      </div>
    </>
  );
}
