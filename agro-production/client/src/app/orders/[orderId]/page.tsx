'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { OrderTimeline, OrderDetailsPanel } from '@/components/OrderTimeline'
import { fetchOrderById } from '@/services/orderService'
import { ApiError, NetworkError } from '@/lib/apiClient'
import type { Order } from '@/types'

/**
 * Order detail page (#1052).
 *
 * Loads through the authenticated API client (Authorization: Bearer via
 * ApiClient) against the configured NEXT_PUBLIC_API_URL base — no
 * same-origin `/api/orders/:id` guesswork. Distinct states:
 *   - 401 → connect-wallet prompt
 *   - 403 → forbidden, without leaking the order's existence
 *   - 404 → actionable not-found
 *   - NetworkError → offline, retryable
 *   - other → server error, retryable
 * Stale requests are aborted when the order id or wallet changes.
 */

type OrderDetailState =
  | { kind: 'loading' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; order: Order }

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { address, connected } = useWallet()
  const [reloadKey, setReloadKey] = useState(0)

  const orderId = params?.orderId as string
  // Everything that changes the request is folded into one key, including the
  // manual retry counter, so "loading" can be derived instead of being written
  // synchronously from an effect (#1084).
  const requestKey = `${orderId}:${address ?? ''}:${reloadKey}`
  const [snapshot, setSnapshot] = useState<{
    key: string
    result: Exclude<OrderDetailState, { kind: 'loading' }> | null
  }>({ key: requestKey, result: null })

  useEffect(() => {
    if (!connected || !address) {
      router.push('/orders')
      return
    }

    // Abort on id/wallet change or unmount so a stale response can never
    // overwrite fresh state.
    const controller = new AbortController()

    fetchOrderById(orderId, { signal: controller.signal })
      .then((order) => {
        if (!controller.signal.aborted)
          setSnapshot({ key: requestKey, result: { kind: 'ready', order } })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return // stale request — ignore
        const result: Exclude<OrderDetailState, { kind: 'loading' }> =
          err instanceof ApiError && err.status === 401
            ? { kind: 'unauthorized' }
            : err instanceof ApiError && err.status === 403
              ? { kind: 'forbidden' }
              : err instanceof ApiError && err.status === 404
                ? { kind: 'not_found' }
                : err instanceof NetworkError
                  ? { kind: 'offline' }
                  : {
                      kind: 'error',
                      message: err instanceof Error ? err.message : 'Failed to load order',
                    }
        setSnapshot({ key: requestKey, result })
      })

    return () => controller.abort()
  }, [requestKey, orderId, connected, address, router])

  // A snapshot from a previous key is a previous request's answer — treat the
  // current one as still loading rather than showing stale data as fresh.
  const state: OrderDetailState =
    snapshot.key === requestKey && snapshot.result ? snapshot.result : { kind: 'loading' }

  if (state.kind === 'loading') {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border rounded w-1/3"></div>
          <div className="h-64 bg-border rounded"></div>
          <div className="h-64 bg-border rounded"></div>
        </div>
      </div>
    )
  }

  if (state.kind !== 'ready') {
    const messages: Record<Exclude<OrderDetailState['kind'], 'loading' | 'ready'>, { title: string; detail: string; tone: 'red' | 'amber' }> = {
      unauthorized: {
        title: 'Connect your wallet to view this order',
        detail: 'Order details are only available to the wallet that placed the order.',
        tone: 'amber',
      },
      forbidden: {
        title: 'This order is not available',
        detail: 'You do not have access to this order.',
        tone: 'amber',
      },
      not_found: {
        title: 'Order not found',
        detail: 'This order does not exist. Check the link or go back to your orders.',
        tone: 'red',
      },
      offline: {
        title: 'You appear to be offline',
        detail: 'Check your connection and try again.',
        tone: 'red',
      },
      error: {
        title: 'Failed to load order',
        detail: state.kind === 'error' ? state.message : '',
        tone: 'red',
      },
    }
    const content = messages[state.kind]
    const tone = content.tone

    return (
      <div className="space-y-6">
        <Link
          href="/orders"
          className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Link>
        <div
          role="alert"
          className={`rounded-xl p-6 text-center border ${
            tone === 'red' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <p className={`font-medium ${tone === 'red' ? 'text-red-700' : 'text-amber-800'}`}>
            {content.title}
          </p>
          <p className={`text-sm mt-1 ${tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>
            {content.detail}
          </p>
          {(state.kind === 'offline' || state.kind === 'error') && (
            <button
              onClick={() => setReloadKey((key) => key + 1)}
              className={`mt-3 rounded-lg border px-4 py-1.5 text-sm ${
                tone === 'red' ? 'border-red-300 hover:bg-red-100 text-red-700' : 'border-amber-300 hover:bg-amber-100 text-amber-800'
              }`}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  const order = state.order

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/orders"
          className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Order Details</h1>
        <p className="text-muted text-sm mt-1">
          Track your order status and delivery timeline.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrderTimeline order={order} />
        <OrderDetailsPanel order={order} />
      </div>
    </div>
  )
}
