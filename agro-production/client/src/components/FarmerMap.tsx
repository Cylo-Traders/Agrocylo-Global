'use client'

import React, { useState, useEffect } from 'react'
import { MapPin, Users } from 'lucide-react'

export interface FarmerLocation {
  id: string
  name: string
  latitude: number
  longitude: number
  cropType?: string
  farmSize?: number
  contact?: string
}

interface FarmerMapProps {
  farmers: FarmerLocation[]
  onFarmerSelect?: (farmer: FarmerLocation) => void
  isLoading?: boolean
}

const FarmerMap: React.FC<FarmerMapProps> = ({
  farmers,
  onFarmerSelect,
  isLoading = false,
}) => {
  const [selectedFarmer, setSelectedFarmer] = useState<FarmerLocation | null>(null)
  const [mapCenter, setMapCenter] = useState({ lat: 0, lng: 0 })

  useEffect(() => {
    if (farmers.length > 0) {
      const avgLat = farmers.reduce((sum, f) => sum + f.latitude, 0) / farmers.length
      const avgLng = farmers.reduce((sum, f) => sum + f.longitude, 0) / farmers.length
      setMapCenter({ lat: avgLat, lng: avgLng })
    }
  }, [farmers])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  // Calculate bounds for centering
  const latMin =
    farmers.length > 0 ? Math.min(...farmers.map((f) => f.latitude)) : mapCenter.lat
  const latMax =
    farmers.length > 0 ? Math.max(...farmers.map((f) => f.latitude)) : mapCenter.lat
  const lngMin =
    farmers.length > 0 ? Math.min(...farmers.map((f) => f.longitude)) : mapCenter.lng
  const lngMax =
    farmers.length > 0 ? Math.max(...farmers.map((f) => f.longitude)) : mapCenter.lng

  const latRange = Math.max(latMax - latMin, 0.1)
  const lngRange = Math.max(lngMax - lngMin, 0.1)

  // Map dimensions
  const mapWidth = 600
  const mapHeight = 400
  const padding = 40

  // Scale factors
  const xScale = (mapWidth - padding * 2) / lngRange
  const yScale = (mapHeight - padding * 2) / latRange

  const getCoordinates = (lat: number, lng: number) => {
    const x = padding + (lng - lngMin) * xScale
    const y = mapHeight - padding - (lat - latMin) * yScale
    return { x, y }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="w-6 h-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">Farmer Locations</h2>
        <span className="ml-auto bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
          {farmers.length} farmers
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
          <svg width={mapWidth} height={mapHeight} className="w-full">
            {/* Background */}
            <rect width={mapWidth} height={mapHeight} fill="#f9fafb" />

            {/* Grid lines */}
            {[0.25, 0.5, 0.75].map((v) => (
              <React.Fragment key={`grid-${v}`}>
                <line
                  x1={padding + lngRange * v * xScale}
                  y1={padding}
                  x2={padding + lngRange * v * xScale}
                  y2={mapHeight - padding}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray="4"
                />
                <line
                  x1={padding}
                  y1={mapHeight - padding - latRange * v * yScale}
                  x2={mapWidth - padding}
                  y2={mapHeight - padding - latRange * v * yScale}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray="4"
                />
              </React.Fragment>
            ))}

            {/* Farmer markers */}
            {farmers.map((farmer) => {
              const coords = getCoordinates(farmer.latitude, farmer.longitude)
              const isSelected = selectedFarmer?.id === farmer.id
              return (
                <g
                  key={farmer.id}
                  onClick={() => {
                    setSelectedFarmer(farmer)
                    onFarmerSelect?.(farmer)
                  }}
                  className="cursor-pointer"
                >
                  {/* Marker circle */}
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={isSelected ? 8 : 6}
                    fill={isSelected ? '#dc2626' : '#2563eb'}
                    opacity="0.8"
                  />
                  {/* Marker border */}
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={isSelected ? 12 : 10}
                    fill="none"
                    stroke={isSelected ? '#dc2626' : '#2563eb'}
                    strokeWidth="2"
                    opacity="0.3"
                  />
                </g>
              )
            })}
          </svg>
        </div>

        {/* Farmer list */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 max-h-96 overflow-y-auto">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Farmers
          </h3>
          <div className="space-y-2">
            {farmers.map((farmer) => (
              <button
                key={farmer.id}
                onClick={() => {
                  setSelectedFarmer(farmer)
                  onFarmerSelect?.(farmer)
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  selectedFarmer?.id === farmer.id
                    ? 'bg-blue-100 border-l-4 border-blue-600'
                    : 'hover:bg-gray-100'
                }`}
              >
                <p className="font-medium text-gray-900">{farmer.name}</p>
                {farmer.cropType && (
                  <p className="text-xs text-gray-600">{farmer.cropType}</p>
                )}
                {farmer.farmSize && (
                  <p className="text-xs text-gray-600">{farmer.farmSize} hectares</p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selected farmer details */}
      {selectedFarmer && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-2">{selectedFarmer.name}</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Coordinates</p>
              <p className="font-medium text-gray-900">
                {selectedFarmer.latitude.toFixed(4)}, {selectedFarmer.longitude.toFixed(4)}
              </p>
            </div>
            {selectedFarmer.cropType && (
              <div>
                <p className="text-gray-600">Crop Type</p>
                <p className="font-medium text-gray-900">{selectedFarmer.cropType}</p>
              </div>
            )}
            {selectedFarmer.farmSize && (
              <div>
                <p className="text-gray-600">Farm Size</p>
                <p className="font-medium text-gray-900">{selectedFarmer.farmSize} ha</p>
              </div>
            )}
            {selectedFarmer.contact && (
              <div>
                <p className="text-gray-600">Contact</p>
                <p className="font-medium text-gray-900">{selectedFarmer.contact}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FarmerMap
