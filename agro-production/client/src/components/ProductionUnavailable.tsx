/**
 * Rendered when a production build is served without the production flag
 * explicitly enabled (issue #1038).
 *
 * This replaces the `redirect('/')` that made the root layout redirect to
 * itself. It is intentionally self-contained — no providers, no client hooks,
 * no fetch — so it renders identically on the server and the client and cannot
 * itself fail in a way that produces a blank page.
 */
export default function ProductionUnavailable({ reason }: { reason: string }) {
  return (
    <main
      id="main-content"
      className="max-w-2xl mx-auto px-4 py-16"
      data-testid="production-unavailable"
    >
      <h1 className="text-2xl font-semibold mb-3">This build is not available</h1>
      <p className="mb-4 text-muted-foreground">
        Agro Production has not been enabled in this deployment. If you expected
        to reach it, the production flag is probably missing from the build
        environment.
      </p>
      <p className="text-sm text-muted-foreground">
        Configuration: <code className="font-mono">{reason}</code>
      </p>
    </main>
  );
}
