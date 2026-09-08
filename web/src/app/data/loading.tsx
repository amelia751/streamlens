import { Connecting } from "@/components/spinner";
import { TONES } from "@/lib/theme";

/**
 * The desk chrome, drawn while the warehouse cuts are still in flight.
 *
 * The page is `force-dynamic` over ClickHouse, so the first request pays for
 * the round trip. Showing the rail and saying what is being waited on is the
 * difference between a slow page and an apparently broken one.
 */
export default function DataLoading() {
  return (
    <div className="data-desk">
      <aside className="rail data-rail" aria-busy>
        <div className="rail-panes">
          <div
            className="data-section on"
            style={{ "--tone": TONES.yellow } as React.CSSProperties}
          >
            <span className="data-section-title">By Title Performance</span>
            <span className="data-section-lede">
              YouTube promo against Weekly Top 10 results, and where each title
              landed country by country.
            </span>
          </div>
          <div
            className="data-section"
            style={{ "--tone": TONES.green } as React.CSSProperties}
          >
            <span className="data-section-title">By Youtube Campaigns</span>
            <span className="data-section-lede">
              What the 44 Netflix YouTube channels publish, where, and in what
              format.
            </span>
          </div>
        </div>
      </aside>
      <main className="data-main">
        <div className="shell">
          <Connecting />
        </div>
      </main>
    </div>
  );
}
