"use client";

import Link from "next/link";

/**
 * /notifications page. The weather-advisory widget that used to link here was
 * removed as dead code (Issue #1224); this route stays because it is a real
 * destination and is linked from the navbar.
 *
 * A full implementation would list weather advisories, order updates,
 * campaign milestones, and system messages.
 */
export default function NotificationsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Link
          href="/home"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Home
        </Link>
      </div>

      <div className="bg-white border rounded-lg p-8 text-center shadow-sm">
        <span className="text-4xl mb-3 block" aria-hidden="true">
          🔔
        </span>
        <p className="text-gray-600 mb-1">No notifications yet</p>
        <p className="text-sm text-gray-500">
          Weather advisories, order updates, and campaign milestones will
          appear here.
        </p>
      </div>
    </main>
  );
}