import Header from "./_components/header";
import Footer from "./_components/footer";
import { MobileBottomNav } from "./_components/mobile-bottom-nav";

/**
 * Public-site shell — renders the fixed Header at the top of every (root)
 * route, the page content as `<main>`, and the Footer at the bottom.
 *
 * Authenticated dashboard and admin sections supply their own shells via
 * (dashboard)/layout.tsx and (admin)/layout.tsx.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 overflow-x-clip pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-0">
        {children}
      </main>
      <MobileBottomNav />
      <Footer />
    </div>
  );
}
