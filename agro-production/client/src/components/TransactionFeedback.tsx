'use client'

import React, { useState } from 'react'
import {
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  X,
  RefreshCw,
} from 'lucide-react'

export type TransactionStatus = 'pending' | 'success' | 'failure'

export interface TransactionFeedback {
  status: TransactionStatus
  title: string
  message: string
  details?: Record<string, string>
  action?: {
    label: string
    onClick: () => void
    loading?: boolean
  }
}

interface TransactionFeedbackProps {
  feedback: TransactionFeedback | null
  onClose?: () => void
  autoClose?: boolean
  autoCloseDuration?: number
}

const TransactionFeedback: React.FC<TransactionFeedbackProps> = ({
  feedback,
  onClose,
  autoClose = true,
  autoCloseDuration = 5000,
}) => {
  const [isVisible, setIsVisible] = useState(!!feedback)

  React.useEffect(() => {
    if (feedback && autoClose && feedback.status !== 'pending') {
      const timer = setTimeout(() => {
        setIsVisible(false)
        onClose?.()
      }, autoCloseDuration)
      return () => clearTimeout(timer)
    }
  }, [feedback, autoClose, autoCloseDuration, onClose])

  if (!feedback || !isVisible) return null

  const getIcon = () => {
    switch (feedback.status) {
      case 'success':
        return <CheckCircle className="w-12 h-12 text-green-500" />
      case 'failure':
        return <XCircle className="w-12 h-12 text-red-500" />
      case 'pending':
      default:
        return <Clock className="w-12 h-12 text-blue-500 animate-spin" />
    }
  }

  const getBackgroundColor = () => {
    switch (feedback.status) {
      case 'success':
        return 'bg-green-50 border-green-200'
      case 'failure':
        return 'bg-red-50 border-red-200'
      case 'pending':
      default:
        return 'bg-blue-50 border-blue-200'
    }
  }

  const getTextColor = () => {
    switch (feedback.status) {
      case 'success':
        return 'text-green-900'
      case 'failure':
        return 'text-red-900'
      case 'pending':
      default:
        return 'text-blue-900'
    }
  }

  return (
    <div
      className={`fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`bg-white rounded-lg shadow-2xl max-w-md w-full border ${getBackgroundColor()} transition-all duration-300 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className="p-6">
          {/* Close button */}
          {feedback.status !== 'pending' && (
            <button
              onClick={() => {
                setIsVisible(false)
                onClose?.()
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Icon and content */}
          <div className="text-center">
            <div className="flex justify-center mb-4">{getIcon()}</div>

            <h2 className={`text-xl font-bold mb-2 ${getTextColor()}`}>
              {feedback.title}
            </h2>

            <p className={`text-sm mb-4 ${getTextColor()} opacity-80`}>
              {feedback.message}
            </p>

            {/* Details */}
            {feedback.details && Object.keys(feedback.details).length > 0 && (
              <div className="bg-white/50 rounded-lg p-3 mb-4 text-left">
                {Object.entries(feedback.details).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex justify-between text-sm text-gray-700 py-1"
                  >
                    <span className="font-medium">{key}:</span>
                    <span className="text-gray-600 break-words">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Action button */}
            {feedback.action && (
              <button
                onClick={feedback.action.onClick}
                disabled={feedback.action.loading}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  feedback.status === 'success'
                    ? 'bg-green-600 hover:bg-green-700 text-white disabled:bg-green-400'
                    : feedback.status === 'failure'
                      ? 'bg-red-600 hover:bg-red-700 text-white disabled:bg-red-400'
                      : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-400'
                }`}
              >
                {feedback.action.loading && (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                )}
                {feedback.action.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TransactionFeedback
