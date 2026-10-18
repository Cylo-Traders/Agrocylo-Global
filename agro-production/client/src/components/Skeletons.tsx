/** Reusable skeleton components that mirror the shape of their real counterparts.
 *  All components use animate-pulse and aria-hidden so screen readers skip them.
 */

function Bone({ className }: { className: string }) {
  return <div className={`bg-neutral-200 rounded ${className}`} />;
}

export function CampaignCardSkeleton() {
  return (
    <div
      className="block border border-border rounded-xl p-5 bg-surface animate-pulse"
      aria-hidden="true"
    >
      {/* header row: farmer address + status badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="space-y-1 min-w-0 flex-1">
          <Bone className="h-3 w-40" />
          <Bone className="h-3 w-28" />
        </div>
        <Bone className="h-5 w-20 rounded-full shrink-0" />
      </div>

      {/* funding bar */}
      <div className="mb-4 space-y-1">
        <div className="flex justify-between">
          <Bone className="h-3 w-24" />
          <Bone className="h-3 w-8" />
        </div>
        <Bone className="h-2 w-full rounded-full" />
        <Bone className="h-3 w-20" />
      </div>

      {/* footer: days left + date */}
      <div className="flex items-center justify-between">
        <Bone className="h-3 w-16" />
        <Bone className="h-3 w-20" />
      </div>
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div
      className="bg-surface border border-border rounded-xl overflow-hidden animate-pulse"
      aria-hidden="true"
    >
      {/* image placeholder */}
      <Bone className="h-36 w-full rounded-none" />
      <div className="p-4 space-y-2">
        {/* name + category badge */}
        <div className="flex items-start justify-between gap-2">
          <Bone className="h-4 w-32" />
          <Bone className="h-4 w-16 rounded-full" />
        </div>
        {/* description */}
        <Bone className="h-3 w-full" />
        <Bone className="h-3 w-3/4" />
        {/* price + location */}
        <div className="flex items-center justify-between pt-1">
          <Bone className="h-4 w-24" />
          <Bone className="h-3 w-16" />
        </div>
        {/* quantity */}
        <Bone className="h-3 w-28" />
      </div>
    </div>
  );
}

export function CampaignDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden="true" aria-label="Loading campaign">
      {/* back link */}
      <Bone className="h-4 w-32" />

      {/* title + status */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Bone className="h-7 w-48" />
          <Bone className="h-3 w-64" />
        </div>
        <Bone className="h-7 w-24 rounded-full" />
      </div>

      {/* farmer info card */}
      <div className="border border-border rounded-xl p-5 bg-surface space-y-3">
        <Bone className="h-4 w-24" />
        <div className="space-y-2">
          <Bone className="h-3 w-16" />
          <Bone className="h-4 w-full" />
          <Bone className="h-3 w-20" />
          <Bone className="h-4 w-full" />
        </div>
      </div>

      {/* stat cards */}
      <div className="space-y-3">
        <Bone className="h-5 w-28" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 bg-surface space-y-2">
              <Bone className="h-3 w-20" />
              <Bone className="h-6 w-24" />
            </div>
          ))}
        </div>
        {/* progress bar card */}
        <div className="border border-border rounded-xl p-4 bg-surface space-y-2">
          <div className="flex justify-between">
            <Bone className="h-3 w-28" />
            <Bone className="h-3 w-8" />
          </div>
          <Bone className="h-3 w-full rounded-full" />
        </div>
      </div>

      {/* timeline */}
      <div className="space-y-3">
        <Bone className="h-5 w-20" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="border border-border rounded-xl p-4 bg-surface space-y-2">
              <Bone className="h-3 w-28" />
              <Bone className="h-4 w-20" />
              <Bone className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrderTableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden animate-pulse" aria-hidden="true">
      {/* thead */}
      <div className="bg-surface border-b border-border px-4 py-2 flex gap-4">
        {[60, 60, 80, 56, 60, 40].map((w, i) => (
          <Bone key={i} className={`h-3 w-${w === 60 ? "16" : w === 80 ? "20" : w === 56 ? "14" : w === 40 ? "10" : "16"}`} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border last:border-0 px-4 py-3 flex gap-4 items-center">
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-20 ml-auto" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="h-3 w-20" />
          <Bone className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Generic inline spinner for button loading states */
export function ButtonSpinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 inline-block ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
