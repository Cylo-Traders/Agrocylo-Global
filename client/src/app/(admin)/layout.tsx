import { AdminShell } from "./_components/admin-shell";

export const metadata = {
  title: {
    template: "%s | AgroCylo Admin",
    default: "Admin",
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
