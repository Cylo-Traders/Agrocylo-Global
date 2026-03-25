"use client";

export default function MapSkeleton() {
  return (
    <div className="relative h-full w-full animate-pulse bg-neutral-200">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="h-12 w-12 rounded-full bg-neutral-300" />
        <div className="h-4 w-40 rounded bg-neutral-300" />
        <div className="h-3 w-28 rounded bg-neutral-300" />
      </div>
    </div>
  );
}
