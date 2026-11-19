'use client'

import React, { useState, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

export type NotificationType = 'success' | 'error' | 'info' | 'warning'

export interface NotificationMessage {
  id: string
  type: NotificationType
  title: string
  message: string
  duration?: number // milliseconds, null for persistent
  action?: {
    label: string
    onClick: () => void
  }
}

interface NotificationProps {
  message: NotificationMessage
  onClose: (id: string) => void
}

const Notification: React.FC<NotificationProps> = ({ message, onClose }) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (message.duration) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        onClose(message.id)
      }, message.duration)
      return () => clearTimeout(timer)
    }
  }, [message.duration, message.id, onClose])

  const getIcon = () => {
    switch (message.type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-500" />
    }
  }

  const getBackgroundColor = () => {
    switch (message.type) {
      case 'success':
        return 'bg-green-50 border-green-200'
      case 'error':
        return 'bg-red-50 border-red-200'
      case 'warning':
        return 'bg-yellow-50 border-yellow-200'
      case 'info':
      default:
        return 'bg-blue-50 border-blue-200'
    }
  }

  if (!isVisible) return null

  return (
    <div
      className={`rounded-lg border p-4 shadow-md flex gap-4 items-start ${getBackgroundColor()} transition-all duration-300`}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">{message.title}</h3>
        <p className="text-sm text-gray-700 mt-1">{message.message}</p>
        {message.action && (
          <button
            onClick={message.action.onClick}
            className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {message.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => {
          setIsVisible(false)
          onClose(message.id)
        }}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

export const NotificationContainer: React.FC<{ notifications: NotificationMessage[] }> = ({
  notifications,
}) => {
  // Dismissal is the only independent state here (#1084): the visible list is
  // derived from the `notifications` prop minus dismissed ids. The previous
  // version mirrored the prop into state through an effect, which both
  // cascaded a render and resurrected dismissed toasts whenever the prop
  // array identity changed.
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const handleClose = React.useCallback((id: string) => {
    setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const displayedNotifications = notifications.filter(
    (notification) => !dismissedIds.includes(notification.id),
  )

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {displayedNotifications.map((notification) => (
        <Notification
          key={notification.id}
          message={notification}
          onClose={handleClose}
        />
      ))}
    </div>
  )
}

export default Notification
