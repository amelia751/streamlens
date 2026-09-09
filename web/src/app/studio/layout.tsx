import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/sidebar";
import { Connecting } from "@/components/spinner";
import { Workspace } from "@/components/workspace";
import {
  fetchDashboards,
  fetchWarehouse,
  type DashboardSummary,
  type Warehouse,
} from "@/lib/api";
import {
  fetchProposalsFromBackend,
  type ProposalSummary,
} from "@/lib/proposals";

/**
 * The rail's contents, which are the only slow thing about this route.
 *
 * `fetchWarehouse` walks ClickHouse's system tables for every source in the
 * tree, so it costs the better part of a second on a warm cache and more on
 * a cold one. It is awaited in here rather than in the layout so that the
 * canvas and the analyst are interactive while it runs — an `await` in a
 * layout body holds back everything the layout renders, which is how this
 * route came to open on an empty screen.
 */
async function Rail() {
  // Together rather than one after another: none of the three reads the
  // others, and awaiting them in a row made the rail cost the sum of a
  // catalog walk and two cheap list calls instead of the slowest one.
  const [wh, dash, prop] = await Promise.allSettled([
    fetchWarehouse(),
    fetchDashboards(),
    fetchProposalsFromBackend(),
  ]);

  const warehouse: Warehouse | null =
    wh.status === "fulfilled" ? wh.value : null;
  // Only the warehouse failing is worth saying out loud — it is the rail's
  // whole subject. An empty dashboard or proposal list reads correctly as
  // "none yet", which is also what a first run looks like.
  const error = wh.status === "rejected" ? String(wh.reason) : undefined;
  const dashboards: DashboardSummary[] =
    dash.status === "fulfilled" ? dash.value : [];
  const proposals: ProposalSummary[] =
    prop.status === "fulfilled" ? prop.value : [];

  return (
    <Sidebar
      warehouse={warehouse}
      dashboards={dashboards}
      proposals={proposals}
      error={error}
    />
  );
}

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Workspace>
      <div className="studio">
        <Suspense
          fallback={
            <aside className="rail" aria-busy>
              <Connecting />
            </aside>
          }
        >
          <Rail />
        </Suspense>
        <main className="studio-main">{children}</main>
        <Chat />
      </div>
    </Workspace>
  );
}
