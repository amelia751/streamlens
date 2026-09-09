"use client";

/**
 * A turn's reasoning, as a stamp rather than a transcript.
 *
 * Gemini titles every beat (`**Investigating Dashboard Options**`). Drawn
 * raw that is a wall of italic paragraphs. Here each heading is reduced to
 * a verb the Studio knows — Investigating, Reading, Designing, Building,
 * Checking — with the icon that goes with it, the way a run log in
 * anhlam/patch stamps Read / Scan / Edit. Consecutive beats of the same
 * verb fold into one row. The whole stream is one block: open while it is
 * still being written, a single "Thought · N" line once it is not.
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

type Group = Stamp & { members: Piece[] };

const STAINS: { test: RegExp; stamp: Stamp }[] = [
  {
    test: /^(investigat|explor|discover|review|inspect|look)/i,
    stamp: { kind: "investigate", label: "Investigating" },
  },
  {
    test: /^(read|quer|preview|list|fetch)/i,
    stamp: { kind: "read", label: "Reading" },
  },
  {
    test: /^(design|defin|refin|concept|map|structur)/i,
    stamp: { kind: "design", label: "Designing" },
  },
  {
    test: /^(build|add|populat|implement|creat|integrat)/i,
    stamp: { kind: "build", label: "Building" },
  },
  {
    test: /^(check|confirm|verif|validat)/i,
    stamp: { kind: "check", label: "Checking" },
  },
  {
    test: /^(analyz|interpret|visualiz|summar)/i,
    stamp: { kind: "analyze", label: "Analyzing" },
  },
];

function stampOf(title: string): Stamp {
  const first = title.trim().split(/\s+/)[0] ?? "";
  return (
    STAINS.find((row) => row.test.test(first))?.stamp ?? {
      kind: "think",
      label: first || "Thought",
    }
  );
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

function fold(pieces: Piece[]): Group[] {
  // By stamp, in the order a stamp first appeared — not by consecutive
  // runs. Gemini interleaves Designing / Analyzing / Designing; folding
  // only neighbours still leaves a play-by-play. The Studio wants the
  // signature: one Investigating row, one Designing row.
  const groups: Group[] = [];
  const index = new Map<Kind, Group>();
  for (const piece of pieces) {
    const stamp = stampOf(piece.title);
    const existing = index.get(stamp.kind);
    if (existing) {
      existing.members.push(piece);
    } else {
      const group: Group = { ...stamp, members: [piece] };
      index.set(stamp.kind, group);
      groups.push(group);
    }
  }
  return groups;
}

/** The heading minus the verb the stamp already says. */
function restOf(title: string, label: string): string {
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

function GroupRow({
  group,
  markdown,
}: {
  group: Group;
  markdown: Components;
}) {
  const [open, setOpen] = useState(false);
  const last = group.members[group.members.length - 1];
  const detail =
    group.members.length > 1
      ? `${group.members.length} thoughts`
      : restOf(last.title, group.label) || last.body.replace(/\s+/g, " ");

  return (
    <div className={`chat-thought-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="chat-thought-head is-row"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon kind={group.kind} />
        <span className="chat-thought-title">{group.label}</span>
        {detail ? <span className="chat-thought-clip">{detail}</span> : null}
      </button>
      {open && (
        <div className="chat-thought-body">
          {group.members.map((piece, i) => (
            <section key={`${piece.title}-${i}`}>
              {group.members.length > 1 && restOf(piece.title, group.label) ? (
                <h4>{restOf(piece.title, group.label)}</h4>
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
  const pieces = piecesOf(text);
  const groups = fold(pieces);
  const latest = pieces[pieces.length - 1];
  const stamp = latest ? stampOf(latest.title) : { kind: "think" as const, label: "Thought" };
  const [forced, setForced] = useState<boolean | null>(null);
  const open = forced ?? Boolean(live);

  const headline = live
    ? restOf(latest?.title ?? "", stamp.label) || stamp.label
    : pieces.length > 1
      ? `${pieces.length} thoughts`
      : restOf(latest?.title ?? "", stamp.label);

  return (
    <div className={`chat-thought${open ? " is-open" : ""}${live ? " is-live" : ""}`}>
      <button
        type="button"
        className="chat-thought-head"
        aria-expanded={open}
        onClick={() => setForced(!open)}
      >
        <span className="chat-thought-chevron" aria-hidden>
          ›
        </span>
        <Icon kind={live ? stamp.kind : "think"} />
        <span className="chat-thought-title">
          {live ? stamp.label : "Thought"}
        </span>
        {headline && headline !== stamp.label ? (
          <span className="chat-thought-clip">{headline}</span>
        ) : null}
      </button>
      {open && (
        <div className="chat-thought-log">
          {groups.map((group, i) => (
            <GroupRow
              key={`${group.kind}-${i}`}
              group={group}
              markdown={markdown}
            />
          ))}
        </div>
      )}
    </div>
  );
}
