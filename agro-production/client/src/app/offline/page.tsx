import Link from "next/link";

export default function OfflinePage() {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="mb-3 text-2xl font-semibold">You&apos;re offline</h1>
      <p className="text-muted">Reconnect to continue viewing Agro Production. For your security, wallet and account data are never stored for offline use.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-primary-600 px-4 py-2 font-medium text-white">Try again</Link>
    </section>
  );
}
