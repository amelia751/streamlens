"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Pause before the label appears, same beat as a shadcn tooltip. */
const DELAY = 400;

/**
 * A hover label in the app theme: ink card, paper type, parked under the
 * control. Used on the chat chrome where a title attribute would be too
 * faint and a visible word would crowd the strip.
 */
export function Tip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      });
    }, DELAY);
  }

  function hide() {
    window.clearTimeout(timer.current);
    setPos(null);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span
      ref={wrap}
      className="tip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            className="tip"
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
