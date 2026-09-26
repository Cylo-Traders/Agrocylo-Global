import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
        <Link href="/marketplace" className="hover:text-foreground">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Product Not Found</span>
      </nav>
      <div className="rounded-xl border border-border p-10 text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Product Not Found</h1>
        <p className="text-muted">The product you're looking for doesn't exist or has been removed.</p>
        <Link
          href="/marketplace"
          className="inline-block mt-4 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Browse Marketplace
        </Link>
      </div>
    </div>
  );
}
