"use client";

/**
 * The Promo Machine, filtered.
 *
 * The cadence cube arrives at month × market × kind grain, so every control
 * pivots it in the browser. Same reasoning as the Greenlight board: one fetch
 * keeps the counters, the cadence, the format ring and the roster describing
 * one consistent slice.
 */
import { useMemo, useState } from "react";
import {
  Panel,
  Stat,
  Stats,
  BarList,
  StackedBars,
  ShareRing,
  DataTable,
} from "@/components/charts";
import { SortableTable } from "@/components/charts/sortable-table";
import {
  ControlBar,
  Select,
  Segmented,
  SearchInput,
} from "@/components/controls";
import { Reveal } from "@/components/motion";
import { compact, commas, num, str, type Row } from "@/lib/api";

const WINDOWS = [
  { value: "12", label: "1y" },
  { value: "24", label: "2y" },
  { value: "36", label: "3y" },
  { value: "0", label: "All" },
];

export function PromoMachine({
  channels,
  cadence,
  campaigns,
}: {
  channels: Row[];
  cadence: Row[];
  campaigns: Row[];
}) {
  const [market, setMarket] = useState("");
  const [kind, setKind] = useState("");
  const [months, setMonths] = useState("36");
  const [search, setSearch] = useState("");

  const markets = useMemo(
    () =>
      [...new Set(cadence.map((r) => str(r.market)).filter(Boolean))].sort(),
    [cadence],
  );
  const kinds = useMemo(
    () => [...new Set(cadence.map((r) => str(r.kind)).filter(Boolean))].sort(),
    [cadence],
  );

  const cutoff = useMemo(() => {
    const m = Number(months);
    if (!m) return null;
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    return d.toISOString().slice(0, 10);
  }, [months]);

  const slice = useMemo(
    () =>
      cadence.filter((r) => {
        if (market && str(r.market) !== market) return false;
        if (kind && str(r.kind) !== kind) return false;
        if (cutoff && str(r.month).slice(0, 10) < cutoff) return false;
        return true;
      }),
    [cadence, market, kind, cutoff],
  );

  // Rows arrive at month × market × kind, so a month appears several times
  // once anything is unfiltered. Fold back to one bar per month.
  const byMonth = useMemo(() => {
    const acc = new Map<string, { label: string; a: number; b: number }>();
    for (const r of slice) {
      const key = str(r.month).slice(0, 7);
      const cur = acc.get(key) ?? { label: key, a: 0, b: 0 };
      cur.a += num(r.shorts);
      cur.b += num(r.long_form);
      acc.set(key, cur);
    }
    return [...acc.values()].sort((x, y) => x.label.localeCompare(y.label));
  }, [slice]);

  const byMarket = useMemo(() => {
    const acc = new Map<string, { label: string; value: number; linked: number }>();
    for (const r of slice) {
      const key = str(r.market) || "—";
      const cur = acc.get(key) ?? { label: key, value: 0, linked: 0 };
      cur.value += num(r.shorts) + num(r.long_form);
      cur.linked += num(r.catalogue_linked);
      acc.set(key, cur);
    }
    return [...acc.values()].sort((x, y) => y.value - x.value).slice(0, 14);
  }, [slice]);

  const shorts = slice.reduce((s, r) => s + num(r.shorts), 0);
  const longForm = slice.reduce((s, r) => s + num(r.long_form), 0);
  const linked = slice.reduce((s, r) => s + num(r.catalogue_linked), 0);

  const roster = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((r) => {
      if (market && str(r.market) !== market) return false;
      if (kind && str(r.kind) !== kind) return false;
      if (q && !str(r.channel).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [channels, market, kind, search]);

  const subs = roster.reduce((s, r) => s + num(r.subscribers), 0);
  const dirty = market !== "" || kind !== "" || months !== "36" || search !== "";

  function reset() {
    setMarket("");
    setKind("");
    setMonths("36");
    setSearch("");
  }

  const windowLabel =
    WINDOWS.find((w) => w.value === months)?.label ?? months;

  return (
    <>
      <Stats>
        <Stat
          label="Channels"
          value={commas(roster.length)}
          hint={market || kind ? "matching filters" : "verified Netflix-operated"}
        />
        <Stat label="Combined subscribers" value={compact(subs)} />
        <Stat
          label="Shorts share"
          value={`${Math.round((shorts / Math.max(shorts + longForm, 1)) * 100)}%`}
          hint={`last ${windowLabel}`}
        />
        <Stat
          label="Catalogue-linked"
          value={`${Math.round((linked / Math.max(shorts + longForm, 1)) * 100)}%`}
          hint="clips carrying a title id"
        />
      </Stats>

      <ControlBar
        dirty={dirty}
        onReset={reset}
        resultLabel={`${commas(shorts + longForm)} uploads · ${commas(roster.length)} channels`}
      >
        <Select
          label="Market"
          value={market}
          onChange={setMarket}
          options={[
            { value: "", label: "All markets" },
            ...markets.map((m) => ({ value: m, label: m })),
          ]}
        />
        <Select
          label="Channel kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "", label: "All kinds" },
            ...kinds.map((k) => ({ value: k, label: k })),
          ]}
        />
        <Segmented
          label="Window"
          value={months}
          onChange={setMonths}
          options={WINDOWS.map((w) => ({ ...w, tone: undefined }))}
        />
        <SearchInput
          label="Channel"
          value={search}
          onChange={setSearch}
          placeholder="Search channels…"
        />
      </ControlBar>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <Panel
            title="Upload cadence"
            subtitle="Monthly output, split by format. The Shorts ramp is the clearest strategy shift in the data."
          >
            <StackedBars data={byMonth} />
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel
            title="Format mix"
            subtitle={`Share of uploads that were Shorts over the last ${windowLabel}.`}
          >
            <ShareRing shorts={shorts} longForm={longForm} />
            <div className="legend justify-center">
              <span>
                <i style={{ background: "var(--yellow)" }} /> Shorts ·{" "}
                {commas(shorts)}
              </span>
              <span>
                <i style={{ background: "var(--blue)" }} /> Long ·{" "}
                {commas(longForm)}
              </span>
            </div>
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mb-5">
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
            emptyLabel="No uploads in this window for the current filters."
          />
        </Panel>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.12}>
          <Panel
            title="Channel roster"
            subtitle="Latest statistics snapshot per channel. Select any column to sort."
          >
            <SortableTable
              rows={roster}
              initialSort="subscribers"
              empty="No channels match these filters."
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
                {
                  key: "videos_loaded",
                  label: "Loaded",
                  align: "right",
                  render: (r) => commas(r.videos_loaded),
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
    </>
  );
}
