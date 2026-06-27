'use client'

import { NotificationPreferences } from '@/components/NotificationPreferences'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted text-sm mt-1">
          Manage your account settings and preferences.
        </p>
      </div>

      <div className="grid gap-6">
        <NotificationPreferences />
      </div>
    </div>
  )
}
