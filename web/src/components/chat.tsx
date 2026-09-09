"use client";

/**
 * Conversations with the analyst. Several at once, each a tab, the way the
 * canvas holds several dashboards — and each one saved, so closing the
 * laptop is not the end of the thread.
 *
 * A tab is one ADK session, stored by the backend. Switching does not lose
 * the thread, and a follow-up in this tab cannot see another tab's turns, so
 * "make that weekly" stays pointed at the dashboard this conversation built.
 *
 * What is held here is a mirror, not the record. The record is the session on
 * the backend: a turn is streamed into local state because that is what makes
 * it feel live, and a thread being reopened is refetched instead of
 * remembered. Closing a tab therefore throws nothing away — it is still in
 * history, and deleting is a separate, deliberate act.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { readPasted, refLink, type Ref } from "@/lib/links";
import { RowMenu } from "@/components/row-menu";
import { SqlBlock, type Ran } from "@/components/sql";
import { Thought } from "@/components/thought";
import { Tip } from "@/components/tip";
import { useWorkspace } from "@/components/workspace";

/**
 * A chart or a canvas the user pasted in, standing for itself.
 *
 * The path is the whole reference — the backend reads the same one back and
 * hands the agent the chart's spec and current numbers. The label is for the
 * person: a chip saying "IMDb rating of top titles" is a reference someone
 * can check, where the URL it came from is not.
 */
type Attachment = { path: string; label: string; whole: boolean };

type Message = {
  role: "user" | "agent" | "thought" | "sql";
  text: string;
  /** What was attached when it was sent, so the turn keeps its receipt. */
  attached?: Attachment[];
  /** On a `sql` row: the call it came from, and what it answered with. */
  ran?: Ran;
  /** The call id, so the outcome can find the statement it belongs to. */
  token?: string;
};

type Conversation = {
  id: string;
  name: string;
  messages: Message[];
  draft: string;
  /** Charts pasted into the draft, sent with it and cleared by it. */
  attached: Attachment[];
  activity?: string;
  busy: boolean;
  /** Whether the transcript has been fetched. Reopened tabs start false. */
  loaded: boolean;
};

/** A thread the backend is holding, as listed for chat history. */
type Saved = {
  id: string;
  title: string;
  updated_at: number;
};

const PROMPTS = [
  "What could you build me from this warehouse?",
  "Build a dashboard of YouTube upload activity by market",
  "Show me how box office and streaming demand track each other",
];

// How many threads come back as tabs on a reload. Enough to carry yesterday's
// work over; not so many that the tab strip is unreadable. The rest are one
// click away in history.
const RESTORED = 3;

function ClockIcon() {
  return (
    <svg className="chat-head-icon" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8 5v3.15l2.05 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}`;
}

function blank(id = newId(), name = "New chat"): Conversation {
  return {
    id,
    name,
    messages: [],
    draft: "",
    attached: [],
    busy: false,
    loaded: true,
  };
}

/**
 * A tab holding nothing: the one "new" reuses instead of stacking another.
 *
 * A reopened thread whose transcript has not arrived yet also has no messages,
 * and it is emphatically not empty — hence `loaded`.
 */
function isPlaceholder(c: Conversation): boolean {
  return (
    c.loaded &&
    !c.busy &&
    c.messages.length === 0 &&
    !c.draft.trim() &&
    c.attached.length === 0
  );
}

/**
 * What to call the thing a pasted path points at.
 *
 * Read from the canvas rather than from the clipboard, so a chart renamed
 * since it was copied comes back under the name it has now — and so a chip
 * only appears for something that is really there.
 */
async function nameOf(ref: Ref): Promise<string> {
  const route =
    ref.kind === "dashboard"
      ? `/api/dashboards/${encodeURIComponent(ref.id)}`
      : `/api/proposals/${encodeURIComponent(ref.id)}`;
  try {
    const res = await fetch(route, { cache: "no-store" });
    if (!res.ok) return "";
    const body = await res.json();
    if (!ref.panelId) return body.title ?? "";
    const panel = (body.panels ?? []).find(
      (p: { id: string; title: string }) => p.id === ref.panelId,
    );
    return panel?.title ?? "";
  } catch {
    return "";
  }
}

/**
 * The activity line, sentence-cased.
 *
 * The labels are written lowercase because they are fragments of a sentence
 * about the agent; on their own line they are the sentence. Only the first
 * letter, so `Reading table schemas` does not become title case.
 */
function capitalize(label: string): string {
  return label ? label[0].toUpperCase() + label.slice(1) : label;
}

/** Same rule the backend names a thread by, so a reload reads the same. */
function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`;
}

function ago(epochSeconds: number): string {
  const minutes = Math.round((Date.now() / 1000 - epochSeconds) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function listSaved(): Promise<Saved[]> {
  try {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()).conversations ?? [];
  } catch {
    return [];
  }
}

/**
 * The charts riding along with a message.
 *
 * Above the box while the message is being written, and above it in the log
 * once it has been sent — the same strip either way, so what was attached to
 * a turn is still visible after the turn. The label opens it on the canvas,
 * because a reference you cannot look at is a reference you have to trust.
 */
function Attached({
  items,
  onOpen,
  onDrop,
}: {
  items: Attachment[];
  onOpen: (path: string) => boolean;
  onDrop?: (path: string) => void;
}) {
  return (
    <div className="chat-refs" aria-label="Attached to this message">
      {items.map((item) => (
        <span key={item.path} className="chat-ref">
          <button
            type="button"
            className="chat-ref-open"
            title={`Show ${item.label} on the canvas`}
            onClick={() => onOpen(item.path)}
          >
            <span className="chat-ref-mark" aria-hidden>
              {item.whole ? "▤" : "▦"}
            </span>
            {item.label}
          </button>
          {onDrop && (
            <button
              type="button"
              className="chat-ref-drop"
              aria-label={`Remove ${item.label}`}
              onClick={() => onDrop(item.path)}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** Split an SSE byte stream into decoded `data:` payloads. */
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6));
    }
  }
}

export function Chat() {
  const {
    touchDashboard,
    touchProposal,
    tabs,
    activeId,
    follow,
    startBuild,
    finishBuild,
    clearBuilds,
    turnStarted,
    turnEnded,
  } = useWorkspace();

  // The canvas tab the user is looking at, sent with every turn. Without
  // it the analyst guesses what "that chart" means.
  const focus = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeId);
    if (tab?.kind === "dashboard") {
      return { focus_kind: "dashboard", focus_id: tab.dashboardId };
    }
    if (tab?.kind === "proposal") {
      return { focus_kind: "proposal", focus_id: tab.proposalId };
    }
    return { focus_kind: "", focus_id: "" };
  }, [tabs, activeId]);

  const [conversations, setConversations] = useState<Conversation[]>(() => [
    blank(),
  ]);
  const [currentId, setCurrentId] = useState(() => conversations[0].id);
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null,
  );

  const current =
    conversations.find((c) => c.id === currentId) ?? conversations[0];

  useEffect(() => {
    if (window.matchMedia("(max-width: 1100px)").matches) setOpen(false);
  }, []);

  const log = useRef<HTMLDivElement>(null);
  // Follow the newest line only while the reader is already at the bottom.
  // A turn writes constantly — thoughts, SQL, activity — and pinning on
  // every write made the log impossible to scroll back through.
  const pinned = useRef(true);

  useEffect(() => {
    pinned.current = true;
  }, [currentId]);

  useEffect(() => {
    if (!pinned.current) return;
    const node = log.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [current?.messages, current?.activity]);

  const patch = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    },
    [],
  );

  /**
   * The other half of a panel's copy button: a link pasted in here becomes a
   * chip standing for that chart, and the chart itself goes with the turn.
   *
   * Whatever was typed around the link stays in the draft. The chip goes up
   * immediately under whatever the path says, and takes the chart's real name
   * when the canvas answers — a paste that shows nothing for a round trip
   * looks like a paste that was swallowed, and a path that resolves to
   * nothing is still better shown than dropped.
   */
  const attach = useCallback(
    async (id: string, refs: Ref[]) => {
      const pasted = refs.map((ref) => ({
        path: refLink(ref),
        label: ref.panelId || ref.id,
        whole: !ref.panelId,
      }));
      patch(id, (c) => ({
        ...c,
        attached: [
          ...c.attached,
          ...pasted.filter((p) => !c.attached.some((a) => a.path === p.path)),
        ],
      }));

      for (const ref of refs) {
        const label = await nameOf(ref);
        if (!label) continue;
        const path = refLink(ref);
        patch(id, (c) => ({
          ...c,
          attached: c.attached.map((a) =>
            a.path === path ? { ...a, label } : a,
          ),
        }));
      }
    },
    [patch],
  );

  const detach = useCallback(
    (id: string, path: string) =>
      patch(id, (c) => ({
        ...c,
        attached: c.attached.filter((a) => a.path !== path),
      })),
    [patch],
  );

  /**
   * The analyst names what it built as a link to it, and this is what makes
   * the link land: a plain click opens the tab, because the canvas is beside
   * the chat and reloading the app to reach it would be absurd.
   *
   * A modifier-click is left to the browser on purpose. The href is a real
   * path the workspace also honours on arrival, so cmd-click opens the same
   * chart in a second window rather than doing nothing.
   */
  const markdown = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const path = href ?? "";
        const inApp = path.startsWith("/studio?");
        return (
          <a
            href={path}
            className={inApp ? "chat-link" : undefined}
            {...(inApp ? {} : { target: "_blank", rel: "noreferrer" })}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              if (follow(path)) e.preventDefault();
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [follow],
  );

  // What the tabs are right now, for the restore below: it decides after an
  // await, by which time the state it closed over is a second out of date.
  const live = useRef(conversations);
  useEffect(() => {
    live.current = conversations;
  }, [conversations]);

  /** Bring back the last few threads, so a reload continues rather than restarts. */
  useEffect(() => {
    let alive = true;

    (async () => {
      const threads = await listSaved();
      if (!alive || threads.length === 0) return;

      setSaved(threads);
      const restored = threads.slice(0, RESTORED).reverse();
      // Someone who pasted a chart and hit send in the first second is mid-
      // turn; their tab is kept either way, but pulling the view onto an old
      // thread underneath them is not a restore, it is an interruption.
      const started = live.current.some((c) => !isPlaceholder(c));
      setConversations((prev) => {
        // The placeholder tab goes only if the user has not touched it.
        const kept = prev.filter((c) => !isPlaceholder(c));
        const reopened = restored.map((thread) => ({
          ...blank(thread.id, thread.title),
          loaded: false,
        }));
        return [...reopened, ...kept];
      });
      if (!started) setCurrentId(restored[restored.length - 1].id);
    })();

    return () => {
      alive = false;
    };
  }, []);

  /**
   * Fill in reopened tabs' transcripts, the one in front first.
   *
   * One at a time, re-running as each lands: three small fetches in a row
   * beats a tab whose history only appears once you click it, and beats a
   * turn typed into a thread the log claims is empty.
   */
  useEffect(() => {
    const pending =
      current && !current.loaded && !current.busy
        ? current
        : conversations.find((c) => !c.loaded && !c.busy);
    if (!pending) return;

    const id = pending.id;
    let alive = true;

    (async () => {
      let messages: Message[] = [];
      let title: string | undefined;
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          messages = body.messages ?? [];
          title = body.title;
        }
      } catch {
        // An unreachable backend is reported by the next turn; a thread that
        // will not load should not also erase the tab.
      }
      if (!alive) return;
      patch(id, (c) =>
        c.busy || c.messages.length > 0
          ? { ...c, loaded: true }
          : { ...c, loaded: true, name: title ?? c.name, messages },
      );
    })();

    return () => {
      alive = false;
    };
  }, [conversations, current, patch]);

  const send = useCallback(
    async (text: string, conversationId?: string) => {
      const id = conversationId ?? currentId;
      const trimmed = text.trim();

      // Read the guard from state, not from inside the updater below. React
      // runs updaters while it renders, which is after this handler returns —
      // a flag set in there is still false here, and the turn silently never
      // leaves the browser.
      const target = conversations.find((c) => c.id === id);
      if (!trimmed || !target || target.busy) return;

      const first = target.messages.length === 0;
      // Read off the draft before it is cleared: the attachments belong to
      // this turn, and the box is empty by the time the request is built.
      const attached = target.attached;
      patch(id, (c) => ({
        ...c,
        name: first ? titleFrom(trimmed) : c.name,
        messages: [
          ...c.messages,
          {
            role: "user",
            text: trimmed,
            attached: attached.length ? attached : undefined,
          },
        ],
        draft: "",
        attached: [],
        busy: true,
        activity: "thinking",
      }));

      pinned.current = true;
      turnStarted();
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            session_id: id,
            attachments: attached.map((a) => a.path),
            ...focus,
          }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());

        // Whether the reply is mid-sentence: set by a piece of prose and
        // cleared by anything else, so a thought or a tool call between two
        // model calls closes the bubble the first one was writing.
        let streaming = false;

        for await (const event of sseEvents(res.body)) {
          if (event.type === "activity") {
            patch(id, (c) => ({ ...c, activity: event.label }));
          } else if (event.type === "thought") {
            patch(id, (c) => {
              const last = c.messages[c.messages.length - 1];
              const messages =
                last?.role === "thought"
                  ? [
                      ...c.messages.slice(0, -1),
                      { role: "thought" as const, text: last.text + event.text },
                    ]
                  : [...c.messages, { role: "thought" as const, text: event.text }];
              // The activity line is not touched. A thought between two tool
              // calls would otherwise downgrade "reading the warehouse" to
              // "thinking" — vaguer, and already said by the thought block
              // pulsing right above it.
              return { ...c, messages };
            });
          } else if (event.type === "sql") {
            // In the log rather than in the activity line: the statement is
            // evidence for the sentence that follows it, and evidence has to
            // still be there after the turn ends.
            patch(id, (c) => ({
              ...c,
              messages: [
                ...c.messages,
                {
                  role: "sql" as const,
                  text: event.query,
                  token: event.token,
                  ran: { label: event.label },
                },
              ],
            }));
          } else if (event.type === "ran") {
            patch(id, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.role === "sql" && m.token === event.token
                  ? {
                      ...m,
                      ran: {
                        ...(m.ran ?? { label: "" }),
                        rows: event.rows ?? undefined,
                        problem: event.problem || undefined,
                        columns: event.columns ?? undefined,
                        sample: event.sample ?? undefined,
                        done: true,
                      },
                    }
                  : m,
              ),
            }));
          } else if (event.type === "canvas") {
            touchDashboard(event.dashboard_id);
          } else if (event.type === "proposal") {
            touchProposal(event.proposal_id);
          } else if (event.type === "building") {
            startBuild({
              token: event.token,
              kind: event.kind,
              dashboardId: event.dashboard_id,
              proposalId: event.proposal_id,
              panelId: event.panel_id || undefined,
              title: event.title || undefined,
              chart: event.chart || undefined,
              width: event.width,
              height: event.height,
            });
          } else if (event.type === "built") {
            finishBuild(event.token, event.panel_id || undefined);
          } else if (event.type === "delta") {
            // A reply arriving as it is written. Whether it continues a bubble
            // is tracked rather than inferred from the last message, because an
            // agent bubble from an earlier model call in the same turn is a
            // finished sentence, not something to keep writing into.
            //
            // Read out here and not inside the updater: React runs an updater
            // during a later render, by which time the flag below has moved on,
            // and the first chunk of a reply would append itself to whatever
            // was in front of it — the user's own message, usually.
            const continues = streaming;
            streaming = true;

            patch(id, (c) => {
              const last = c.messages[c.messages.length - 1];
              return {
                ...c,
                messages: continues
                  ? [
                      ...c.messages.slice(0, -1),
                      {
                        role: "agent" as const,
                        text: (last?.text ?? "") + event.text,
                      },
                    ]
                  : [...c.messages, { role: "agent" as const, text: event.text }],
              };
            });
            continue;
          } else if (event.type === "text") {
            patch(id, (c) => ({
              ...c,
              messages: [...c.messages, { role: "agent", text: event.text }],
            }));
          } else if (event.type === "error") {
            patch(id, (c) => ({
              ...c,
              messages: [
                ...c.messages,
                { role: "agent", text: `Something broke: ${event.message}` },
              ],
            }));
          }
          streaming = false;
        }
      } catch (e) {
        patch(id, (c) => ({
          ...c,
          messages: [...c.messages, { role: "agent", text: String(e) }],
        }));
      } finally {
        patch(id, (c) => ({ ...c, activity: undefined, busy: false }));
        // Whatever the turn had not finished making, it is not going to now —
        // including when it failed, which is when a placeholder left shimmering
        // would be a lie.
        clearBuilds();
        turnEnded();
        // The turn just created or renamed a thread on the backend.
        setSaved(await listSaved());
      }
    },
    [
      conversations,
      currentId,
      focus,
      patch,
      touchDashboard,
      touchProposal,
      startBuild,
      finishBuild,
      clearBuilds,
      turnStarted,
      turnEnded,
    ],
  );

  /**
   * A new thread is local until its first turn. The backend writes the session
   * when the turn arrives, which is why an afternoon of clicking + does not
   * leave a column of empty conversations in history.
   */
  const startConversation = useCallback(() => {
    const idle = conversations.find(isPlaceholder);
    if (idle) {
      setCurrentId(idle.id);
      return;
    }
    // Built out here, not inside the updater: React may run an updater twice,
    // and two `blank()` calls would mint two ids for one tab.
    const next = blank();
    setConversations((prev) => [...prev, next]);
    setCurrentId(next.id);
  }, [conversations]);

  const closeTab = useCallback(
    (id: string) => {
      const index = conversations.findIndex((c) => c.id === id);
      if (index === -1) return;

      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const reset = blank();
        setConversations([reset]);
        setCurrentId(reset.id);
        return;
      }

      setConversations(remaining);
      // Closing the tab you are on lands you on its neighbour to the left.
      if (currentId === id) {
        setCurrentId((remaining[index - 1] ?? remaining[0]).id);
      }
    },
    [conversations, currentId],
  );

  /** Open a saved thread as a tab, or focus it if it already is one. */
  const reopen = useCallback((thread: Saved) => {
    setShowSaved(false);
    setConversations((prev) => {
      if (prev.some((c) => c.id === thread.id)) return prev;
      const fresh = { ...blank(thread.id, thread.title), loaded: false };
      // Drop an untouched placeholder rather than stacking a tab beside it.
      const kept = prev.filter((c) => !isPlaceholder(c));
      return [...kept, fresh];
    });
    setCurrentId(thread.id);
  }, []);

  const forget = useCallback(
    async (thread: Saved) => {
      setSaved((prev) => prev.filter((t) => t.id !== thread.id));
      closeTab(thread.id);
      try {
        const res = await fetch(`/api/conversations/${thread.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        setSaved(await listSaved());
        throw e;
      }
    },
    [closeTab],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      setRenaming(null);
      const named = titleFrom(title);
      if (!named) return;
      patch(id, (c) => ({ ...c, name: named }));
      setSaved((prev) =>
        prev.map((t) => (t.id === id ? { ...t, title: named } : t)),
      );
      try {
        await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: named }),
        });
      } catch {
        // A thread with no turns yet has nothing to rename on the backend.
      }
    },
    [patch],
  );

  if (!open) {
    return (
      <button
        type="button"
        className="chat-reopen"
        onClick={() => setOpen(true)}
      >
        Analyst
      </button>
    );
  }

  return (
    <aside className="chat" aria-label="Conversation with the analyst">
      <header className="chat-head">
        <div
          className="tabbar chat-tabs"
          role="tablist"
          aria-label="Conversations"
        >
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`tab is-chat${conversation.id === current.id ? " on" : ""}`}
              onClick={() => setCurrentId(conversation.id)}
              onDoubleClick={() =>
                setRenaming({ id: conversation.id, value: conversation.name })
              }
              role="tab"
              aria-selected={conversation.id === current.id}
              tabIndex={0}
              onKeyDown={(e) =>
                e.key === "Enter" && setCurrentId(conversation.id)
              }
            >
              {renaming?.id === conversation.id ? (
                <input
                  className="chat-rename"
                  value={renaming.value}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setRenaming({ id: conversation.id, value: e.target.value })
                  }
                  onBlur={() => rename(conversation.id, renaming.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(conversation.id, renaming.value);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span className="tab-name" title={conversation.name}>
                  {conversation.name}
                </span>
              )}
              {conversation.busy && <span className="chat-tab-busy" aria-hidden />}
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${conversation.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(conversation.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <Tip label="New Tab">
          <button
            type="button"
            className="chat-new"
            onClick={startConversation}
            aria-label="New Tab"
          >
            +
          </button>
        </Tip>
        <Tip label="Chat History">
          <button
            type="button"
            className={`chat-saved-toggle${showSaved ? " on" : ""}`}
            onClick={() => setShowSaved((shown) => !shown)}
            aria-label="Chat History"
            aria-pressed={showSaved}
          >
            <ClockIcon />
          </button>
        </Tip>
        <Tip label="Close">
          <button
            type="button"
            className="chat-hide"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </Tip>
      </header>

      {showSaved && (
        <div className="chat-saved">
          {saved.length === 0 ? (
            <p className="chat-saved-empty">
              Nothing here yet. A conversation is kept once you ask something.
            </p>
          ) : (
            <ul>
              {saved.map((thread) => (
                <li key={thread.id}>
                  <button type="button" onClick={() => reopen(thread)}>
                    <span className="chat-saved-title">{thread.title}</span>
                    <span className="chat-saved-when">
                      {ago(thread.updated_at)}
                    </span>
                  </button>
                  <RowMenu
                    title={thread.title}
                    note="The transcript is gone, and the analyst stops being able to recall it."
                    onDelete={() => forget(thread)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className="chat-log"
        ref={log}
        onScroll={() => {
          const node = log.current;
          if (!node) return;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        {current.messages.length === 0 && (
          <div className="chat-intro">
            <ul className="chat-prompts">
              {PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button type="button" onClick={() => send(prompt, current.id)}>
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {current.messages.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="chat-said">
              {message.attached && (
                <Attached items={message.attached} onOpen={follow} />
              )}
              <p className="chat-msg is-user">{message.text}</p>
            </div>
          ) : message.role === "sql" ? (
            <SqlBlock
              key={`${current.id}-sql-${i}`}
              query={message.text}
              ran={message.ran ?? { label: "" }}
            />
          ) : message.role === "thought" ? (
            <Thought
              key={i}
              text={message.text}
              live={current.busy && i === current.messages.length - 1}
              markdown={markdown}
            />
          ) : (
            <div key={`${current.id}-${i}`} className="chat-msg is-agent">
              <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
                {message.text}
              </Markdown>
            </div>
          ),
        )}

        {current.activity && (
          <p className="chat-activity">
            <span className="chat-pulse" />
            {capitalize(current.activity)}…
          </p>
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(current.draft, current.id);
        }}
      >
        {/* One box: the charts riding along sit inside it, above what is
            being typed, the way a highlighted phrase sits in the sentence
            it belongs to rather than on a shelf above it. */}
        <div className="chat-box">
          {current.attached.length > 0 && (
            <Attached
              items={current.attached}
              onOpen={follow}
              onDrop={(path) => detach(current.id, path)}
            />
          )}
          <textarea
            className="chat-input"
            value={current.draft}
            rows={2}
            placeholder={current.busy ? "Working…" : "Ask for a dashboard"}
            onChange={(e) =>
              patch(current.id, (c) => ({ ...c, draft: e.target.value }))
            }
            onPaste={(e) => {
              const { refs, rest } = readPasted(
                e.clipboardData.getData("text/plain"),
              );
              if (refs.length === 0) return;

              // The link is lifted out of the text and the rest is typed in as
              // usual, at the cursor, because a paste is often mid-sentence.
              e.preventDefault();
              const box = e.currentTarget;
              const from = box.selectionStart ?? box.value.length;
              const to = box.selectionEnd ?? from;
              patch(current.id, (c) => ({
                ...c,
                draft: c.draft.slice(0, from) + rest + c.draft.slice(to),
              }));
              void attach(current.id, refs);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(current.draft, current.id);
              }
            }}
          />
        </div>

        <button
          type="submit"
          className="chat-send"
          disabled={current.busy || !current.draft.trim()}
        >
          {current.busy ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
