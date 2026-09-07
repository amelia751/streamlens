import { Shell, ErrorNote } from "@/components/shell";
import { runQuery, type Row } from "@/lib/api";
import { ROOMS } from "@/lib/theme";
import { PromoMachine } from "./machine";

export const dynamic = "force-dynamic";

export const metadata = { title: "Promo" };

export default async function PromoMachinePage() {
  let channels: Row[] = [];
  let cadence: Row[] = [];
  let campaigns: Row[] = [];
  try {
    const [c, ca, cp] = await Promise.all([
      runQuery("promo_channels"),
      runQuery("promo_cadence_detail", { months: 60 }),
      runQuery("promo_campaigns", { limit: 25 }),
    ]);
    channels = c.rows;
    cadence = ca.rows;
    campaigns = cp.rows;
  } catch (error) {
    return (
      <Shell title="Promo" {...ROOMS.promo}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="Promo"
      lede="What the 44 Netflix YouTube channels publish, where, and in what format."
      {...ROOMS.promo}
    >
      <PromoMachine
        channels={channels}
        cadence={cadence}
        campaigns={campaigns}
      />
    </Shell>
  );
}
