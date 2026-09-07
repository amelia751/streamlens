import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/sidebar";
import { Workspace } from "@/components/workspace";
import {
  fetchDashboards,
  fetchWarehouse,
  type DashboardSummary,
  type Warehouse,
} from "@/lib/api";

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let warehouse: Warehouse | null = null;
  let dashboards: DashboardSummary[] = [];
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

  return (
    <Workspace>
      <div className="studio">
        <Sidebar
          warehouse={warehouse}
          dashboards={dashboards}
          error={error}
        />
        <main className="studio-main">{children}</main>
        <Chat />
      </div>
    </Workspace>
  );
}
