'use client'

import { CheckCircle, Circle, Clock, Package, Truck, AlertCircle, DollarSign } from 'lucide-react'
import type { Order } from '@/types'

export interface OrderEvent {
  id: string
  type: 'created' | 'escrow_funded' | 'shipped' | 'delivered' | 'dispute_opened' | 'confirmed'
  timestamp: string
  description: string
  status: 'completed' | 'current' | 'pending'
}

interface OrderTimelineProps {
  order: Order
  events?: OrderEvent[]
}

function generateEventsFromOrder(order: Order): OrderEvent[] {
  const events: OrderEvent[] = []

  events.push({
    id: '1',
    type: 'created',
    timestamp: order.createdAt,
    description: 'Order placed and awaiting escrow funding',
    status: 'completed',
  })

  if (order.ledger > 0) {
    events.push({
      id: '2',
      type: 'escrow_funded',
      timestamp: order.createdAt,
      description: 'Payment secured in escrow',
      status: 'completed',
    })
  }

  if (order.status === 'CONFIRMED') {
    events.push({
      id: '3',
      type: 'shipped',
      timestamp: order.updatedAt,
      description: 'Order shipped by farmer',
      status: 'completed',
    })

    events.push({
      id: '4',
      type: 'delivered',
      timestamp: order.updatedAt,
      description: 'Order delivered and confirmed',
      status: 'completed',
    })
  } else if (order.status === 'PENDING') {
    events.push({
      id: '3',
      type: 'shipped',
      timestamp: new Date().toISOString(),
      description: 'Awaiting shipment',
      status: 'current',
    })

    events.push({
      id: '4',
      type: 'delivered',
      timestamp: new Date().toISOString(),
      description: 'Pending delivery confirmation',
      status: 'pending',
    })
  }

  return events
}

const EVENT_ICONS = {
  created: Clock,
  escrow_funded: DollarSign,
  shipped: Package,
  delivered: Truck,
  dispute_opened: AlertCircle,
  confirmed: CheckCircle,
}

const EVENT_COLORS = {
  completed: 'text-green-600 bg-green-50 border-green-200',
  current: 'text-blue-600 bg-blue-50 border-blue-200',
  pending: 'text-gray-400 bg-gray-50 border-gray-200',
}

export function OrderTimeline({ order, events: customEvents }: OrderTimelineProps) {
  const events = customEvents || generateEventsFromOrder(order)

  const getStatusBadge = (status: Order['status']) => {
    const styles = {
      PENDING: 'bg-yellow-100 text-yellow-700 border-yellow-300',
      CONFIRMED: 'bg-green-100 text-green-700 border-green-300',
    }
    return styles[status] || 'bg-gray-100 text-gray-700 border-gray-300'
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Order Timeline</h2>
        <span
          className={`text-xs font-medium px-3 py-1 rounded-full border ${getStatusBadge(order.status)}`}
        >
          {order.status}
        </span>
      </div>

      <div className="space-y-4">
        {events.map((event, index) => {
          const Icon = EVENT_ICONS[event.type] || Circle
          const isLast = index === events.length - 1
          const colorClass = EVENT_COLORS[event.status]

          return (
            <div key={event.id} className="relative flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${colorClass}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                {!isLast && (
                  <div
                    className={`w-0.5 flex-1 mt-2 ${
                      event.status === 'completed' ? 'bg-green-300' : 'bg-gray-300'
                    }`}
                    style={{ minHeight: '2rem' }}
                  />
                )}
              </div>

              <div className="flex-1 pb-6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        event.status === 'pending' ? 'text-muted' : 'text-foreground'
                      }`}
                    >
                      {event.description}
                    </p>
                    <p
                      className={`text-xs mt-1 ${
                        event.status === 'pending' ? 'text-muted' : 'text-muted'
                      }`}
                    >
                      {event.status === 'pending'
                        ? 'Not yet completed'
                        : new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 pt-6 border-t border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">Next Steps</h3>
        {order.status === 'PENDING' && (
          <p className="text-sm text-muted">
            Waiting for the farmer to ship your order. You will be notified when the item is
            shipped.
          </p>
        )}
        {order.status === 'CONFIRMED' && (
          <p className="text-sm text-green-600">
            Order completed successfully. Thank you for your purchase!
          </p>
        )}
      </div>
    </div>
  )
}

export function OrderDetailsPanel({ order }: { order: Order }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Order Details</h2>
      
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Order ID</dt>
          <dd className="font-mono text-foreground">{order.id.slice(0, 12)}...</dd>
        </div>
        
        <div className="flex justify-between">
          <dt className="text-muted">Campaign ID</dt>
          <dd className="font-mono text-foreground">{order.campaignId.slice(0, 12)}...</dd>
        </div>
        
        <div className="flex justify-between">
          <dt className="text-muted">Amount</dt>
          <dd className="font-semibold text-foreground">{order.amount} XLM</dd>
        </div>
        
        <div className="flex justify-between">
          <dt className="text-muted">Buyer Address</dt>
          <dd className="font-mono text-xs text-foreground">
            {order.buyerAddress.slice(0, 6)}...{order.buyerAddress.slice(-6)}
          </dd>
        </div>
        
        {order.txHash && (
          <div className="flex justify-between">
            <dt className="text-muted">Transaction</dt>
            <dd className="font-mono text-xs text-primary-600">
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${order.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                View on Explorer
              </a>
            </dd>
          </div>
        )}
        
        <div className="flex justify-between">
          <dt className="text-muted">Created</dt>
          <dd className="text-foreground">{new Date(order.createdAt).toLocaleString()}</dd>
        </div>
        
        <div className="flex justify-between">
          <dt className="text-muted">Last Updated</dt>
          <dd className="text-foreground">{new Date(order.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  )
}
