"use client";

/**
 * A turn's reasoning, as stamps rather than a transcript.
 *
 * Gemini titles every beat (`**Investigating Dashboard Options**`). Drawn raw
 * that is a wall of italic paragraphs. Here each heading is reduced to a verb
 * the Studio knows — Investigating, Reading, Designing, Building, Checking —
 * with the icon that goes with it, the way a run log in anhlam/patch stamps
 * Read / Scan / Edit.
 *
 * Beats keep the order they were thought in, so a row sits in the log between
 * the query it followed and the query it led to. Only a run of the same verb,
 * one beat after another, folds into a single row.
 */

import { useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Kind =
  | "investigate"
  | "read"
  | "design"
  | "build"
  | "check"
  | "analyze"
  | "think";

type Stamp = { kind: Kind; label: string };

type Piece = { title: string; body: string };

type Beat = Stamp & { members: Piece[] };

const STAINS: { test: RegExp; stamp: Stamp }[] = [
  {
    test: /^(investigat|explor|discover|review|inspect|look|examin)/i,
    stamp: { kind: "investigate", label: "Investigating" },
  },
  {
    test: /^(read|quer|preview|list|fetch|pull)/i,
    stamp: { kind: "read", label: "Reading" },
  },
  {
    test: /^(design|defin|refin|concept|map|structur|plan|choos|select)/i,
    stamp: { kind: "design", label: "Designing" },
  },
  {
    test: /^(build|add|populat|implement|creat|integrat|writ)/i,
    stamp: { kind: "build", label: "Building" },
  },
  {
    test: /^(check|confirm|verif|validat|test|correct|fix)/i,
    stamp: { kind: "check", label: "Checking" },
  },
  {
    test: /^(analyz|assess|interpret|visualiz|summar|calculat|identif|pinpoint)/i,
    stamp: { kind: "analyze", label: "Analyzing" },
  },
];

function stampOf(title: string): Stamp {
  const first = title.trim().split(/\s+/)[0] ?? "";
  const known = STAINS.find((row) => row.test.test(first))?.stamp;
  if (known) return known;
  // An unrecognised verb is still a verb, and reads better as the stamp than
  // a generic one would: "Grouping", "Weighing". A heading that opens on a
  // noun — "Market Shorts Data" — has no verb to promote, so it keeps the
  // plain stamp and shows the whole heading as its subject instead.
  if (/ing$/i.test(first) && first.length > 4) {
    return { kind: "think", label: first[0].toUpperCase() + first.slice(1) };
  }
  return { kind: "think", label: "Thinking" };
}

function piecesOf(text: string): Piece[] {
  const marks = [...text.matchAll(/^\*\*(.+?)\*\*\s*$/gm)];
  if (marks.length === 0) {
    const line = text.trim().split("\n").find(Boolean) ?? "Thought";
    return [{ title: line.replace(/\*+/g, "").trim() || "Thought", body: text }];
  }
  return marks.map((mark, i) => ({
    title: mark[1].trim(),
    body: text.slice(mark.index! + mark[0].length, marks[i + 1]?.index).trim(),
  }));
}

/** Runs of the same verb, in the order they were thought. */
function beatsOf(pieces: Piece[]): Beat[] {
  const beats: Beat[] = [];
  for (const piece of pieces) {
    const stamp = stampOf(piece.title);
    const last = beats[beats.length - 1];
    if (last && last.kind === stamp.kind) last.members.push(piece);
    else beats.push({ ...stamp, members: [piece] });
  }
  return beats;
}

/** The heading minus the verb the stamp already says. */
function subjectOf(title: string, label: string): string {
  return title.replace(new RegExp(`^${label}\\s+`, "i"), "").trim();
}

function Icon({ kind }: { kind: Kind }) {
  const common = {
    className: "chat-thought-icon",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "investigate":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="3.4" />
          <path d="M10 10.2 13.2 13.4" />
        </svg>
      );
    case "read":
      return (
        <svg {...common}>
          <path d="M2.4 8s2-3.4 5.6-3.4S13.6 8 13.6 8s-2 3.4-5.6 3.4S2.4 8 2.4 8Z" />
          <circle cx="8" cy="8" r="1.5" />
        </svg>
      );
    case "design":
      return (
        <svg {...common}>
          <path d="M9.6 3.2 12.8 6.4 6.2 13H3v-3.2L9.6 3.2Z" />
        </svg>
      );
    case "build":
      return (
        <svg {...common}>
          <rect x="2.4" y="2.4" width="4.6" height="4.6" rx="0.6" />
          <rect x="8.9" y="2.4" width="4.6" height="4.6" rx="0.6" />
          <rect x="2.4" y="8.9" width="4.6" height="4.6" rx="0.6" />
          <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="0.6" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.2" />
          <path d="M5.4 8.1 7.2 9.9 10.7 6.2" />
        </svg>
      );
    case "analyze":
      return (
        <svg {...common}>
          <path d="M2.4 13V3.2" />
          <path d="M2.4 13h11.2" />
          <path d="M5.2 10.2V7.4" />
          <path d="M8 10.2V5.2" />
          <path d="M10.8 10.2V8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 2.6a4.2 4.2 0 0 0-3.4 6.7c.4.5.7 1.1.7 1.7v.4h5.4v-.4c0-.6.3-1.2.7-1.7A4.2 4.2 0 0 0 8 2.6Z" />
          <path d="M6.2 13.2h3.6" />
        </svg>
      );
  }
}

/** One stamped row: the verb, what it was about, and the reasoning on ask. */
function BeatRow({
  beat,
  live,
  markdown,
}: {
  beat: Beat;
  live?: boolean;
  markdown: Components;
}) {
  const [forced, setForced] = useState<boolean | null>(null);
  const open = forced ?? Boolean(live);

  // The most recent subject, not a count: the row is a place in the turn, and
  // where the thinking has got to says more than how many sentences it took.
  const latest = beat.members[beat.members.length - 1];
  const subject =
    subjectOf(latest.title, beat.label) || latest.body.replace(/\s+/g, " ");

  return (
    <div
      className={`chat-thought${open ? " is-open" : ""}${live ? " is-live" : ""}`}
    >
      <button
        type="button"
        className="chat-thought-head"
        aria-expanded={open}
        onClick={() => setForced(!open)}
      >
        <span className="chat-thought-chevron" aria-hidden>
          ›
        </span>
        <Icon kind={beat.kind} />
        <span className="chat-thought-title">{beat.label}</span>
        {subject ? <span className="chat-thought-clip">{subject}</span> : null}
      </button>

      {open && (
        <div className="chat-thought-body">
          {beat.members.map((piece, i) => (
            <section key={`${piece.title}-${i}`}>
              {beat.members.length > 1 && subjectOf(piece.title, beat.label) ? (
                <h4>{subjectOf(piece.title, beat.label)}</h4>
              ) : null}
              <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
                {piece.body || piece.title}
              </Markdown>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function Thought({
  text,
  live,
  markdown,
}: {
  text: string;
  live?: boolean;
  markdown: Components;
}) {
  const beats = beatsOf(piecesOf(text));

  return (
    <div className="chat-thoughts">
      {beats.map((beat, i) => (
        <BeatRow
          key={`${beat.kind}-${i}`}
          beat={beat}
          live={live && i === beats.length - 1}
          markdown={markdown}
        />
      ))}
    </div>
  );
}
