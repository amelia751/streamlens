"use client";

/**
 * The conversation, over the left third of the canvas.
 *
 * Nothing the agent says is drawn as a chart. When a turn changes a
 * dashboard the stream sends only its id and the canvas refetches it, so
 * what you read here and what you see there cannot disagree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useWorkspace } from "@/components/workspace";

type Message = {
  role: "user" | "agent" | "thought";
  text: string;
};

const PROMPTS = [
  "What could you build me from this warehouse?",
  "Build a dashboard of YouTube upload activity by market",
  "Show me how box office and streaming demand track each other",
];

/** Split an SSE byte stream into decoded `data:` payloads. */
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; a partial one stays buffered.
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

  // The tab the user is looking at, sent with every turn. Without it the
  // analyst has to guess what "that chart" means, and with several
  // dashboards on the rail it guesses wrong — and an edit to the wrong
  // dashboard removes a panel nobody asked to lose.
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [activity, setActivity] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(max-width: 1100px)").matches) setOpen(false);
  }, []);

  // One session for the life of the tab, so "make that one weekly" resolves.
  const session = useRef<string>("");
  if (!session.current) {
    session.current =
      globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}`;
  }

  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, activity]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;

      setMessages((m) => [...m, { role: "user", text }]);
      setDraft("");
      setBusy(true);
      setActivity("thinking");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            session_id: session.current,
            ...focus,
          }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());

        for await (const event of sseEvents(res.body)) {
          if (event.type === "activity") {
            setActivity(event.label);
          } else if (event.type === "thought") {
            setActivity("thinking");
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last?.role === "thought") {
                return [
                  ...m.slice(0, -1),
                  { role: "thought", text: last.text + event.text },
                ];
              }
              return [...m, { role: "thought", text: event.text }];
            });
          } else if (event.type === "canvas") {
            touchDashboard(event.dashboard_id);
          } else if (event.type === "proposal") {
            touchProposal(event.proposal_id);
          } else if (event.type === "text") {
            setMessages((m) => [...m, { role: "agent", text: event.text }]);
          } else if (event.type === "error") {
            setMessages((m) => [
              ...m,
              { role: "agent", text: `Something broke: ${event.message}` },
            ]);
          }
        }
      } catch (e) {
        setMessages((m) => [...m, { role: "agent", text: String(e) }]);
      } finally {
        setActivity(undefined);
        setBusy(false);
      }
    },
    [busy, touchDashboard, touchProposal, focus],
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
        <span className="chat-name">Analyst</span>
        <button
          type="button"
          className="chat-hide"
          onClick={() => setOpen(false)}
          aria-label="Hide the conversation"
        >
          ×
        </button>
      </header>

      <div className="chat-log" ref={log}>
        {messages.length === 0 && (
          <div className="chat-intro">
            <ul className="chat-prompts">
              {PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button type="button" onClick={() => send(prompt)}>
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message, i) =>
          message.role === "user" ? (
            <p key={i} className="chat-msg is-user">
              {message.text}
            </p>
          ) : message.role === "thought" ? (
            <p key={i} className="chat-msg is-thought">
              {message.text}
            </p>
          ) : (
            // The model writes markdown — lists of options, bold figures,
            // backticked table names. Rendered rather than shown raw.
            // react-markdown drops embedded HTML, which is what we want from
            // text a model produced.
            <div key={i} className="chat-msg is-agent">
              <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
            </div>
          ),
        )}

        {activity && (
          <p className="chat-activity">
            <span className="chat-pulse" />
            {activity}…
          </p>
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="chat-input"
          value={draft}
          rows={2}
          placeholder={busy ? "Working…" : "Ask for a dashboard"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; shift-enter is a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button type="submit" className="chat-send" disabled={busy || !draft.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
