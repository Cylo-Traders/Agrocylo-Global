export default function OfflinePage() {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="mb-3 text-2xl font-semibold">You’re offline</h1>
      <p className="text-muted">Reconnect to continue viewing Agro Production. For your security, wallet and account data are never stored for offline use.</p>
      <a className="mt-6 inline-block rounded-lg bg-primary-600 px-4 py-2 font-medium text-white" href="/">Try again</a>
    </section>
  );
}
