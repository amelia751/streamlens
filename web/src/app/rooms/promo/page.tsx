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
      <Shell title="The Promo Machine" {...ROOMS.promo}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="The Promo Machine"
      lede="The 44 Netflix-operated YouTube channels as a single publishing operation. Channel identity is pinned to the immutable UC id, not the handle — several Netflix handles are squatted or have been reassigned."
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
