/**
 * Primitives for the architecture figure on `/diagram`.
 *
 * Two marks, kept apart on purpose. `Icon` is a stroked glyph that inherits
 * `currentColor`, the same shape language as the studio rail. `Brand` is a
 * vendor logo from `public/diagram/`, always full colour and never recoloured,
 * because those are other people's trademarks.
 */

export type Glyph =
  | "person"
  | "shield"
  | "table"
  | "plug"
  | "film"
  | "lock";

export function Icon({ glyph, tone }: { glyph: Glyph; tone?: string }) {
  return (
    <svg
      className="dg-ico"
      viewBox="0 0 24 24"
      aria-hidden
      style={tone ? { color: tone } : undefined}
    >
      {shape(glyph)}
    </svg>
  );
}

function shape(glyph: Glyph) {
  switch (glyph) {
    case "person":
      return (
        <>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5.5 19.6c1.3-3.5 3.6-5.2 6.5-5.2s5.2 1.7 6.5 5.2" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3.2l7 2.6v6c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9v-6z" />
          <path d="M8.8 12.2l2.3 2.3 4.1-4.6" />
        </>
      );
    case "table":
      return (
        <>
          <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
          <path d="M3.4 9.4h17.2M3.4 14.4h17.2M9.6 9.4v10" />
        </>
      );
    case "plug":
      return (
        <>
          <path d="M9 3.4v5M15 3.4v5" />
          <path d="M6.4 8.4h11.2v2.2a5.6 5.6 0 0 1-5.6 5.6 5.6 5.6 0 0 1-5.6-5.6z" />
          <path d="M12 16.2v4.4" />
        </>
      );
    case "film":
      return (
        <>
          <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
          <path d="M8 4.6v14.8M16 4.6v14.8M3.4 12h4.6M16 12h4.6" />
        </>
      );
    case "lock":
      return (
        <>
          <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2.2" />
          <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
        </>
      );
  }
}

export function Brand({
  src,
  label,
  note,
}: {
  src: string;
  label: string;
  note?: string;
}) {
  return (
    <span className="dg-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/diagram/${src}.svg`} alt="" width={18} height={18} />
      <b>{label}</b>
      {note ? <i>{note}</i> : null}
    </span>
  );
}
