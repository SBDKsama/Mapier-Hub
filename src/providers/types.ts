/**
 * Core type definitions for the place provider abstraction layer
 */

// Search query structure
export interface SearchQuery {
  // Geospatial parameters (required)
  location: {
    lat: number
    lon: number
    radius?: number // meters, default: 1000
  }

  // Filters (optional)
  query?: string // Text search on place name
  category?: string // Filter by primary_category
  limit?: number // Max results, default: 20
  offset?: number // Pagination offset, default: 0
}

export interface BoundedSearchQuery {
  bounds: {
    northeast: { lat: number; lon: number }
    southwest: { lat: number; lon: number }
  }
  limit?: number
}

// Place data structure (canonical format)
export interface Place {
  id: string
  name: string
  location: {
    lat: number
    lon: number
  }
  category: {
    primary: string
    secondary?: string[]
  }
  confidence: number // 0-1, data quality score

  // Contact info
  socials?: string[]
  websites?: string[]
  phones?: string[]
  emails?: string[]

  // Address info
  street?: string
  city?: string
  state?: string
  postcode?: string
  country?: string

  // Metadata
  brand?: string
  operating_status?: string
  google_place_id?: string

  // Flexible attributes (rating, hours, etc.) - mapped to 'attributes' column or jsonb
  attributes?: Record<string, any>

  // Runtime only
  distance?: number // Distance from search point in meters

  // Provider metadata (merged into 'raw' jsonb in DB)
  providers?: {
    [key: string]: {
      externalId: string
      raw: any
    }
  }
}

// Provider result structure
export interface ProviderResult {
  provider: string // Provider name (e.g., "local", "google", "osm")
  places: Place[]
  metadata: {
    count: number
    cached: boolean
    latency: number // milliseconds
    confidence: number // 0-1, overall result quality
  }
}

// Base provider interface
export interface PlaceProvider {
  // Provider metadata
  readonly name: string
  readonly priority: number // Lower = higher priority
  readonly timeout: number // Max wait time in ms

  // Core methods
  search(query: SearchQuery): Promise<ProviderResult>
  getPlace(id: string): Promise<Place | null>
  healthCheck(): Promise<boolean>
}

// Provider configuration
export interface ProviderConfig {
  name: string
  priority: number
  timeout: number
  enabled: boolean
}
