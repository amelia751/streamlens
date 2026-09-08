"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function Kebab() {
  return (
    <svg className="rail-kebab-icon" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="3.2" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.8" r="1.25" />
    </svg>
  );
}

function ConfirmDelete({
  title,
  note,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  note: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="confirm-scrim"
      role="presentation"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">Delete “{title}”?</h2>
        <p>{note} It cannot be undone.</p>
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The kebab and its confirmation, shared by every deletable row.
 *
 * `onDelete` owns the request and whatever optimistic update goes with it,
 * and throws if the row has to come back. This owns the menu, the dialog,
 * and reporting the failure where the person who asked for it is looking.
 */
export function RowMenu({
  title,
  note,
  onDelete,
}: {
  title: string;
  note: string;
  onDelete: () => Promise<void>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const node = e.target as Node;
      if (wrap.current?.contains(node) || sheet.current?.contains(node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      await onDelete();
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rail-kebab-wrap" ref={wrap}>
        <button
          type="button"
          className={`rail-kebab${open ? " on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = (
              e.currentTarget as HTMLButtonElement
            ).getBoundingClientRect();
            const menu = 44;
            const below = rect.bottom + 4 + menu;
            setMenuPos({
              top:
                below > window.innerHeight
                  ? Math.max(8, rect.top - menu - 4)
                  : rect.bottom + 4,
              right: window.innerWidth - rect.right,
            });
            setOpen((v) => !v);
          }}
        >
          <Kebab />
        </button>
        {open &&
          createPortal(
            <div
              ref={sheet}
              className="rail-menu"
              role="menu"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <button
                type="button"
                role="menuitem"
                className="rail-menu-item is-danger"
                onClick={() => {
                  setOpen(false);
                  setConfirm(true);
                }}
              >
                Delete
              </button>
            </div>,
            document.body,
          )}
      </div>
      {confirm && (
        <ConfirmDelete
          title={title}
          note={note}
          busy={busy}
          error={error}
          onCancel={() => {
            if (busy) return;
            setConfirm(false);
            setError(undefined);
          }}
          onConfirm={run}
        />
      )}
    </>
  );
}
