import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'
import { supabase } from '../config/supabase.js'

/**
 * Local database provider
 * Queries the Supabase/PostgreSQL database using PostGIS functions
 */
export class LocalDatabaseProvider extends BaseProvider {
  constructor() {
    super({
      name: 'local',
      priority: 1, // Highest priority (always query first)
      timeout: 5000, // 5 seconds
      enabled: true,
    })
  }

  /**
   * Search for places in the local database
   */
  async search(query: SearchQuery): Promise<ProviderResult> {
    const { result, latency } = await this.measureTime(async () => {
      // Call the Postgres function we created
      const { data, error } = await supabase.rpc('search_places_nearby_v2', {
        search_lat: query.location.lat,
        search_lon: query.location.lon,
        radius_meters: query.location.radius || 1000,
        search_query: query.query || null,
        category_filter: query.category || null,
        result_limit: query.limit || 20,
        result_offset: query.offset || 0,
      })

      if (error) {
        this.log('error', 'Search query failed', error)
        throw new Error(`Local search failed: ${error.message}`)
      }

      // Transform database results to Place format
      const places: Place[] = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        location: {
          lat: row.lat,
          lon: row.lon,
        },
        category: {
          primary: row.primary_category || 'unknown',
          secondary: [], // Can be extracted from raw if needed
        },
        confidence: row.confidence || 0.7,
        socials: row.socials || [],
        websites: row.websites || [],
        attributes: row.raw || {},
        distance: row.distance_meters,
        providers: {
          local: {
            externalId: row.id,
            raw: row.raw,
          },
        },
      }))

      return places
    })

    this.log('info', `Found ${result.length} places in ${latency}ms`)

    return {
      provider: this.name,
      places: result,
      metadata: {
        count: result.length,
        cached: false,
        latency,
        confidence: 1.0, // Local data is always trusted
      },
    }
  }

  /**
   * Get a single place by ID from the local database
   */
  async getPlace(id: string): Promise<Place | null> {
    const { data, error } = await supabase.rpc('get_place_by_id', {
      place_id: id,
    })

    if (error) {
      this.log('error', `Failed to fetch place ${id}`, error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    const row = data[0]
    return {
      id: row.id,
      name: row.name,
      location: {
        lat: row.lat,
        lon: row.lon,
      },
      category: {
        primary: row.primary_category || 'unknown',
        secondary: [],
      },
      confidence: row.confidence || 0.7,
      socials: row.socials || [],
      websites: row.websites || [],
      attributes: row.raw || {},
      providers: {
        local: {
          externalId: row.id,
          raw: row.raw,
        },
      },
    }
  }

  /**
   * Health check: verify database connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await supabase.from('places').select('count').limit(1)
      return !error
    } catch (error) {
      this.log('error', 'Health check failed', error)
      return false
    }
  }
}
