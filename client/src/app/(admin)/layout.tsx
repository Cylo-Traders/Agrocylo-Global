import AuthGuard from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AdminSidebar } from "./_components/admin-sidebar";
import { AdminHeader } from "./_components/admin-header";
import { AuditDegradedBanner } from "./_components/audit-degraded-banner";
import { DashboardFooter } from "@/components/shared/dashboard-footer";
import { SkipLink } from "@/components/shared/skip-link";

export const metadata = {
  title: {
    template: "%s | Cylo Admin",
    default: "Admin",
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      <div className="hidden lg:block">
        <AdminSidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <AuditDegradedBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6"
          data-lenis-prevent
        >
          <ErrorBoundary>
            <AuthGuard requiredRole="admin">{children}</AuthGuard>
          </ErrorBoundary>
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
