import Link from "next/link";

export function DashboardFooter() {
  return (
    <footer className="shrink-0 border-t bg-card px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p>
          &copy; {new Date().getFullYear()}{" "}
          <span className="font-semibold text-foreground">Cylo</span>. All rights reserved.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/about" className="hover:text-foreground transition-colors">
            About
          </Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">
            Support
          </Link>
          <span>Powered by Starknet</span>
        </div>
      </div>
    </footer>
  );
}
