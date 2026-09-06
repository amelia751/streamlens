"use client";

import { useState } from "react";

/**
 * The Gemini greenlight brief.
 *
 * Loaded on demand rather than with the page: the backend runs four retrieval
 * steps and then a model call, and blocking the dashboard on that would make
 * every navigation feel broken.
 */
export function GreenlightBrief({ title }: { title: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brief?title=${encodeURIComponent(title)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? body.detail ?? res.statusText);
      setText(body.brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dealt">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker" style={{ marginBottom: 4 }}>
            Gemini · Vertex
          </p>
          <h2
            className="m-0 text-[1.2rem] font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-cheltenham), Georgia, serif",
            }}
          >
            Greenlight brief
          </h2>
          <p className="mt-1 max-w-xl text-[0.8125rem] leading-relaxed text-muted">
            Over a fixed four-step retrieval pipeline. Every figure comes from
            the same queries that draw the charts below.
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className={`pill ${text || loading ? "" : "on"}`}
        >
          {loading ? "Reading the evidence…" : text ? "Run again" : "Write brief"}
        </button>
      </header>

      {loading && (
        <div className="space-y-2" aria-live="polite">
          {[90, 97, 84].map((w, i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-ink/8"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="m-0 text-[0.8125rem]" style={{ color: "var(--accent)" }}>
          Brief unavailable: {error}
        </p>
      )}

      {text && !loading && (
        <div className="space-y-3">
          {text.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="m-0 text-sm leading-relaxed text-ink">
              {p}
            </p>
          ))}
        </div>
      )}

      {!text && !loading && !error && (
        <p className="empty">No brief generated yet for this title.</p>
      )}
    </section>
  );
}
