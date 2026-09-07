import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/sidebar";
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

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    <Workspace>
      <div className="studio">
        <Sidebar
          warehouse={warehouse}
          dashboards={dashboards}
          proposals={proposals}
          error={error}
        />
        <main className="studio-main">{children}</main>
        <Chat />
      </div>
    </Workspace>
  );
}
