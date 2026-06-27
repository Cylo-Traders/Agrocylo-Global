'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { OrderTimeline, OrderDetailsPanel } from '@/components/OrderTimeline'
import type { Order } from '@/types'

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { address, connected } = useWallet()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orderId = params?.orderId as string

  useEffect(() => {
    if (!connected || !address) {
      router.push('/orders')
      return
    }

    const fetchOrder = async () => {
      setLoading(true)
      setError(null)
      
      try {
        const response = await fetch(`/api/orders/${orderId}`)
        if (!response.ok) {
          throw new Error('Order not found')
        }
        const data = await response.json()
        setOrder(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order')
      } finally {
        setLoading(false)
      }
    }

    if (orderId) {
      fetchOrder()
    }
  }, [orderId, connected, address, router])

  if (loading) {
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

  if (error || !order) {
    return (
      <div className="space-y-6">
        <Link
          href="/orders"
          className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Link>
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-center">
          <p className="text-red-700">{error || 'Order not found'}</p>
        </div>
      </div>
    )
  }

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
