import AuthGuard from "@/components/AuthGuard";
import { DashboardSidebar } from "./_components/dashboard-sidebar";
import { DashboardHeader } from "./_components/dashboard-header";
import { DashboardFooter } from "@/components/shared/dashboard-footer";

export const metadata = {
  title: {
    template: "%s | AgroCylo Dashboard",
    default: "Dashboard",
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden lg:block">
        <DashboardSidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader />
        <main
          className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6"
          data-lenis-prevent
        >
          <AuthGuard requiredRole="farmer">{children}</AuthGuard>
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
