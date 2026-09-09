import Link from "next/link";

import { Stagger, StaggerItem } from "@/components/motion";
import { ROOMS } from "@/lib/theme";

function DataMark() {
  return (
    <svg className="deal-mark" viewBox="0 0 48 48" aria-hidden>
      <ellipse cx="24" cy="12" rx="14" ry="5.5" />
      <path d="M10 12v24c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5V12" />
      <path d="M10 24c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5" />
    </svg>
  );
}

function StudioMark() {
  return (
    <svg className="deal-mark" viewBox="0 0 48 48" aria-hidden>
      <rect x="7" y="9" width="34" height="30" rx="4" />
      <path d="M7 18h34" />
      <path d="M14 33l6.5-8 5 4L34 18" />
    </svg>
  );
}

/**
 * The two ways in, dealt as cards.
 *
 * Title, tone and lede come from the same masthead the destination itself
 * uses, so a card here cannot describe a page differently than the page does.
 */
const DESTINATIONS = [
  {
    ...ROOMS.data,
    Mark: DataMark,
    actions: [
      { href: "/data?view=titles", label: "Title performance" },
      { href: "/data?view=promo", label: "Campaigns" },
    ],
  },
  {
    ...ROOMS.studio,
    Mark: StudioMark,
    actions: [{ href: "/studio", label: "Open the canvas" }],
  },
];

export default function Home() {
  return (
    <div className="shell deal-page">
      <Stagger className="deal">
        {DESTINATIONS.map(({ Mark, ...d }) => (
          <StaggerItem key={d.title} className={`deal-slot tone-${d.tone}`}>
            <article className="dest-card">
              <div className="dest-card-top">
                <Mark />
                <h2>{d.title}</h2>
              </div>
              <div className="dest-card-body">
                <p>{d.lede}</p>
                <div className="card-actions">
                  {d.actions.map((a) => (
                    <Link key={a.href} className="pill" href={a.href}>
                      {a.label}
                    </Link>
                  ))}
                </div>
              </div>
            </article>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
