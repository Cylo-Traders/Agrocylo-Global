'use client'

import { useState, useEffect } from 'react'
import { Bell, CheckCircle } from 'lucide-react'

export interface NotificationPreferencesState {
  orderNotifications: boolean
  disputeNotifications: boolean
  systemNotifications: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferencesState = {
  orderNotifications: true,
  disputeNotifications: true,
  systemNotifications: true,
}

const STORAGE_KEY = 'notification_preferences'

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferencesState>(DEFAULT_PREFERENCES)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setPreferences(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to parse notification preferences', e)
      }
    }
    setLoading(false)
  }, [])

  const handleToggle = (key: keyof NotificationPreferencesState) => {
    setPreferences((prev) => {
      const updated = { ...prev, [key]: !prev[key] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-border rounded w-1/3"></div>
          <div className="h-4 bg-border rounded w-2/3"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold text-foreground">Notification Preferences</h2>
      </div>
      <p className="text-sm text-muted mb-6">
        Choose which notifications you want to receive.
      </p>

      <div className="space-y-4">
        <div className="flex items-start justify-between py-3 border-b border-border">
          <div className="flex-1">
            <label htmlFor="order-notifications" className="text-sm font-medium text-foreground cursor-pointer">
              Order Notifications
            </label>
            <p className="text-xs text-muted mt-1">
              Receive updates about your orders, including confirmations and status changes.
            </p>
          </div>
          <button
            id="order-notifications"
            role="switch"
            aria-checked={preferences.orderNotifications}
            onClick={() => handleToggle('orderNotifications')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              preferences.orderNotifications ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                preferences.orderNotifications ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between py-3 border-b border-border">
          <div className="flex-1">
            <label htmlFor="dispute-notifications" className="text-sm font-medium text-foreground cursor-pointer">
              Dispute Notifications
            </label>
            <p className="text-xs text-muted mt-1">
              Get notified about dispute activities and resolutions.
            </p>
          </div>
          <button
            id="dispute-notifications"
            role="switch"
            aria-checked={preferences.disputeNotifications}
            onClick={() => handleToggle('disputeNotifications')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              preferences.disputeNotifications ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                preferences.disputeNotifications ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between py-3">
          <div className="flex-1">
            <label htmlFor="system-notifications" className="text-sm font-medium text-foreground cursor-pointer">
              System Notifications
            </label>
            <p className="text-xs text-muted mt-1">
              Receive system updates, announcements, and maintenance notices.
            </p>
          </div>
          <button
            id="system-notifications"
            role="switch"
            aria-checked={preferences.systemNotifications}
            onClick={() => handleToggle('systemNotifications')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              preferences.systemNotifications ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                preferences.systemNotifications ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {saved && (
        <div className="mt-4 flex items-center gap-2 text-sm text-green-600" role="status" aria-live="polite">
          <CheckCircle className="w-4 h-4" />
          <span>Preferences saved successfully</span>
        </div>
      )}
    </div>
  )
}

export function getNotificationPreferences(): NotificationPreferencesState {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch (e) {
      return DEFAULT_PREFERENCES
    }
  }
  return DEFAULT_PREFERENCES
}

export function shouldShowNotification(type: 'order' | 'dispute' | 'system'): boolean {
  const prefs = getNotificationPreferences()
  switch (type) {
    case 'order':
      return prefs.orderNotifications
    case 'dispute':
      return prefs.disputeNotifications
    case 'system':
      return prefs.systemNotifications
    default:
      return true
  }
}
