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
  let warehouse: Warehouse | null = null;
  let dashboards: DashboardSummary[] = [];
  let proposals: ProposalSummary[] = [];
  let error: string | undefined;
  try {
    warehouse = await fetchWarehouse();
  } catch (e) {
    error = String(e);
  }
  try {
    dashboards = await fetchDashboards();
  } catch {
    dashboards = [];
  }
  try {
    proposals = await fetchProposalsFromBackend();
  } catch {
    proposals = [];
  }

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
