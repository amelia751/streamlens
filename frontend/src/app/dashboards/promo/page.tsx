import { Shell, ErrorNote } from "@/components/shell";
import {
  Panel,
  Stat,
  DataTable,
  BarList,
  StackedBars,
  ShareRing,
} from "@/components/charts";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { runQuery, compact, commas, num, str } from "@/lib/api";
import { ROOMS } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function PromoMachine() {
  let channels: Record<string, unknown>[] = [];
  let cadence: Record<string, unknown>[] = [];
  let markets: Record<string, unknown>[] = [];
  let campaigns: Record<string, unknown>[] = [];
  try {
    const [c, ca, m, cp] = await Promise.all([
      runQuery("promo_channels"),
      runQuery("promo_cadence", { months: 36 }),
      runQuery("promo_market_mix"),
      runQuery("promo_campaigns", { limit: 25 }),
    ]);
    channels = c.rows;
    cadence = ca.rows;
    markets = m.rows;
    campaigns = cp.rows;
  } catch (error) {
    return (
      <Shell title="The Promo Machine" {...ROOMS.promo}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  const subs = channels.reduce((s, r) => s + num(r.subscribers), 0);
  const shorts = cadence.reduce((s, r) => s + num(r.shorts), 0);
  const longForm = cadence.reduce((s, r) => s + num(r.long_form), 0);

  const byMarket = Object.values(
    markets.reduce<
      Record<string, { label: string; value: number; linked: number }>
    >((acc, r) => {
      const k = str(r.market) || "—";
      acc[k] ??= { label: k, value: 0, linked: 0 };
      acc[k].value += num(r.videos);
      acc[k].linked += num(r.catalogue_linked);
      return acc;
    }, {}),
  )
    .sort((a, b) => b.value - a.value)
    .slice(0, 14);

  return (
    <Shell
      title="The Promo Machine"
      lede="The 44 Netflix-operated YouTube channels as a single publishing operation. Channel identity is pinned to the immutable UC id, not the handle — several Netflix handles are squatted or have been reassigned."
      {...ROOMS.promo}
    >
      <Stagger className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StaggerItem>
          <Stat
            label="Channels"
            value={commas(channels.length)}
            hint="verified Netflix-operated"
            index={1}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Combined subscribers" value={compact(subs)} index={2} />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Shorts share"
            value={`${Math.round((shorts / Math.max(shorts + longForm, 1)) * 100)}%`}
            hint="last 36 months"
            index={0}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Catalogue-linked"
            value={commas(campaigns.length)}
            hint="distinct campaigns shown"
            index={3}
          />
        </StaggerItem>
      </Stagger>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <Panel
            title="Upload cadence"
            subtitle="Monthly output across all channels, split by format. The Shorts ramp is the clearest strategy shift in the data."
          >
            <StackedBars
              data={cadence.map((r) => ({
                label: str(r.month).slice(0, 7),
                a: num(r.shorts),
                b: num(r.long_form),
              }))}
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel
            title="Format mix"
            subtitle="Share of uploads that were Shorts over the same 36 months."
          >
            <ShareRing shorts={shorts} longForm={longForm} />
            <div className="legend justify-center">
              <span>
                <i style={{ background: "var(--yellow)" }} /> Shorts · {commas(shorts)}
              </span>
              <span>
                <i style={{ background: "var(--blue)" }} /> Long · {commas(longForm)}
              </span>
            </div>
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mb-6">
        <Panel
          title="Output by market"
          subtitle="Videos published per market. The note is the share carrying a Netflix catalogue id in the description."
        >
          <BarList
            tone="teal"
            data={byMarket.map((m) => ({
              label: m.label,
              value: m.value,
              note: `${Math.round((m.linked / Math.max(m.value, 1)) * 100)}% linked`,
            }))}
          />
        </Panel>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.12}>
          <Panel
            title="Channel roster"
            subtitle="Latest statistics snapshot per channel."
          >
            <DataTable
              rows={channels}
              columns={[
                { key: "channel", label: "Channel" },
                { key: "market", label: "Market" },
                { key: "kind", label: "Kind" },
                {
                  key: "subscribers",
                  label: "Subs",
                  align: "right",
                  render: (r) => compact(r.subscribers),
                },
                {
                  key: "lifetime_views",
                  label: "Views",
                  align: "right",
                  render: (r) => compact(r.lifetime_views),
                },
              ]}
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.16}>
          <Panel
            title="Widest campaigns"
            subtitle="Grouped by the Netflix catalogue id found in video descriptions — a far more reliable join key than the video title."
          >
            <DataTable
              rows={campaigns}
              columns={[
                {
                  key: "first_title",
                  label: "First clip",
                  render: (r) => (
                    <span className="block max-w-[22rem] truncate">
                      {str(r.first_title)}
                    </span>
                  ),
                },
                { key: "channels", label: "Ch", align: "right" },
                { key: "clips", label: "Clips", align: "right" },
                {
                  key: "netflix_title_id",
                  label: "Catalogue id",
                  align: "right",
                  render: (r) => (
                    <a
                      href={`https://www.netflix.com/title/${str(r.netflix_title_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="title-link"
                    >
                      {str(r.netflix_title_id)}
                    </a>
                  ),
                },
              ]}
            />
          </Panel>
        </Reveal>
      </div>
    </Shell>
  );
}
