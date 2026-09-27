import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link href="/campaigns" className="text-sm text-muted hover:text-foreground">← Back to Campaigns</Link>
      </nav>
      <div className="rounded-xl border border-border p-10 text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Campaign Not Found</h1>
        <p className="text-muted">The campaign you're looking for doesn't exist or has been removed.</p>
        <Link
          href="/campaigns"
          className="inline-block mt-4 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Browse All Campaigns
        </Link>
      </div>
    </div>
  );
}
