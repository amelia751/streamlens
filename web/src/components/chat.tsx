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
 * Saved, and deleting is a separate, deliberate act.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useWorkspace } from "@/components/workspace";

type Message = {
  role: "user" | "agent" | "thought";
  text: string;
};

type Conversation = {
  id: string;
  name: string;
  messages: Message[];
  draft: string;
  activity?: string;
  busy: boolean;
  /** Whether the transcript has been fetched. Reopened tabs start false. */
  loaded: boolean;
};

/** A thread the backend is holding, as listed for the Saved panel. */
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
// click away in Saved.
const RESTORED = 3;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}`;
}

function blank(id = newId(), name = "New chat"): Conversation {
  return { id, name, messages: [], draft: "", busy: false, loaded: true };
}

/**
 * A tab holding nothing: the one "new" reuses instead of stacking another.
 *
 * A reopened thread whose transcript has not arrived yet also has no messages,
 * and it is emphatically not empty — hence `loaded`.
 */
function isPlaceholder(c: Conversation): boolean {
  return c.loaded && !c.busy && c.messages.length === 0 && !c.draft.trim();
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
  const { touchDashboard, touchProposal, tabs, activeId } = useWorkspace();

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
  const [deleting, setDeleting] = useState<Saved | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null,
  );

  const current =
    conversations.find((c) => c.id === currentId) ?? conversations[0];

  useEffect(() => {
    if (window.matchMedia("(max-width: 1100px)").matches) setOpen(false);
  }, []);

  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [current?.messages, current?.activity]);

  const patch = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    },
    [],
  );

  /** Bring back the last few threads, so a reload continues rather than restarts. */
  useEffect(() => {
    let alive = true;

    (async () => {
      const threads = await listSaved();
      if (!alive || threads.length === 0) return;

      setSaved(threads);
      const restored = threads.slice(0, RESTORED).reverse();
      setConversations((prev) => {
        // The placeholder tab goes only if the user has not touched it.
        const started = prev.filter((c) => !isPlaceholder(c));
        const reopened = restored.map((thread) => ({
          ...blank(thread.id, thread.title),
          loaded: false,
        }));
        return [...reopened, ...started];
      });
      setCurrentId(restored[restored.length - 1].id);
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
      patch(id, (c) => ({
        ...c,
        name: first ? titleFrom(trimmed) : c.name,
        messages: [...c.messages, { role: "user", text: trimmed }],
        draft: "",
        busy: true,
        activity: "thinking",
      }));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            session_id: id,
            ...focus,
          }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());

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
              return { ...c, activity: "thinking", messages };
            });
          } else if (event.type === "canvas") {
            touchDashboard(event.dashboard_id);
          } else if (event.type === "proposal") {
            touchProposal(event.proposal_id);
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
        }
      } catch (e) {
        patch(id, (c) => ({
          ...c,
          messages: [...c.messages, { role: "agent", text: String(e) }],
        }));
      } finally {
        patch(id, (c) => ({ ...c, activity: undefined, busy: false }));
        // The turn just created or renamed a thread on the backend.
        setSaved(await listSaved());
      }
    },
    [conversations, currentId, focus, patch, touchDashboard, touchProposal],
  );

  /**
   * A new thread is local until its first turn. The backend writes the session
   * when the turn arrives, which is why an afternoon of clicking + does not
   * leave a column of empty conversations in Saved.
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
      setDeleting(null);
      setSaved((prev) => prev.filter((t) => t.id !== thread.id));
      closeTab(thread.id);
      try {
        await fetch(`/api/conversations/${thread.id}`, { method: "DELETE" });
      } catch {
        // It stays on the backend; the next list refresh will show it again.
      }
      setSaved(await listSaved());
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
        <button
          type="button"
          className="chat-new"
          onClick={startConversation}
          aria-label="New conversation"
          title="New conversation"
        >
          +
        </button>
        <button
          type="button"
          className={`chat-saved-toggle${showSaved ? " on" : ""}`}
          onClick={() => setShowSaved((shown) => !shown)}
          aria-label="Saved conversations"
          title="Saved conversations"
        >
          Saved
        </button>
        <button
          type="button"
          className="chat-hide"
          onClick={() => setOpen(false)}
          aria-label="Hide the conversation"
        >
          ×
        </button>
      </header>

      {showSaved && (
        <div className="chat-saved">
          {saved.length === 0 ? (
            <p className="chat-saved-empty">
              Nothing saved yet. A conversation is kept once you ask something.
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
                  <button
                    type="button"
                    className="chat-saved-delete"
                    aria-label={`Delete ${thread.title}`}
                    onClick={() => setDeleting(thread)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deleting && (
        <div className="chat-confirm">
          <p>
            Delete “{deleting.title}”? The transcript is gone, and the analyst
            stops being able to recall it.
          </p>
          <div className="chat-confirm-actions">
            <button type="button" onClick={() => forget(deleting)}>
              Delete
            </button>
            <button type="button" onClick={() => setDeleting(null)}>
              Keep
            </button>
          </div>
        </div>
      )}

      <div className="chat-log" ref={log}>
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
            <p key={i} className="chat-msg is-user">
              {message.text}
            </p>
          ) : message.role === "thought" ? (
            <p key={i} className="chat-msg is-thought">
              {message.text}
            </p>
          ) : (
            <div key={`${current.id}-${i}`} className="chat-msg is-agent">
              <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
            </div>
          ),
        )}

        {current.activity && (
          <p className="chat-activity">
            <span className="chat-pulse" />
            {current.activity}…
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
        <textarea
          className="chat-input"
          value={current.draft}
          rows={2}
          placeholder={current.busy ? "Working…" : "Ask for a dashboard"}
          onChange={(e) =>
            patch(current.id, (c) => ({ ...c, draft: e.target.value }))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(current.draft, current.id);
            }
          }}
        />
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
