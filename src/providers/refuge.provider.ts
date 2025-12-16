import axios from 'axios'
import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'

/**
 * Refuge Restrooms Provider
 * Integrates Refuge Restrooms API for gender-neutral and accessible restrooms
 * API Docs: https://www.refugerestrooms.org/api/docs/
 */
export class RefugeRestroomsProvider extends BaseProvider {
  private readonly baseURL = 'https://www.refugerestrooms.org/api/v1'

  constructor() {
    super({
      name: 'refuge',
      priority: 3, // Lower priority (niche data source)
      timeout: 5000, // 5 seconds
      enabled: true, // Public API, no key required
    })

    this.log('info', 'Refuge Restrooms provider initialized')
  }

  /**
   * Search for restrooms using Refuge API
   * Only searches when category is restroom-related
   */
  async search(query: SearchQuery): Promise<ProviderResult> {
    // Only search if looking for restrooms
    const isRestroomQuery =
      query.category?.includes('restroom') ||
      query.query?.toLowerCase().includes('restroom') ||
      query.query?.toLowerCase().includes('bathroom') ||
      query.query?.toLowerCase().includes('toilet')

    if (!isRestroomQuery) {
      // Return empty results for non-restroom queries
      return {
        provider: this.name,
        places: [],
        metadata: {
          count: 0,
          cached: false,
          latency: 0,
          confidence: 0.8,
        },
      }
    }

    const { result, latency } = await this.measureTime(async () => {
      try {
        // Refuge API uses by_location endpoint
        const response = await axios.get(`${this.baseURL}/restrooms/by_location`, {
          params: {
            lat: query.location.lat,
            lng: query.location.lon,
            per_page: query.limit || 20,
          },
          timeout: this.timeout,
        })

        const places = response.data.map((restroom: any) => this.transformRefugeRestroom(restroom))

        // Filter by radius (Refuge API doesn't support radius parameter)
        const radius = query.location.radius || 5000
        const filtered = places.filter((place: Place) => {
          const distance = this.calculateDistance(
            query.location.lat,
            query.location.lon,
            place.location.lat,
            place.location.lon
          )
          return distance <= radius
        })

        return filtered
      } catch (error) {
        this.log('error', 'Refuge API search failed', error)
        throw error
      }
    })

    this.log('info', `Found ${result.length} restrooms from Refuge in ${latency}ms`)

    return {
      provider: this.name,
      places: result,
      metadata: {
        count: result.length,
        cached: false,
        latency,
        confidence: 0.8, // Community-sourced data
      },
    }
  }

  /**
   * Get restroom details by ID
   */
  async getPlace(id: string): Promise<Place | null> {
    try {
      // Refuge API doesn't have a single restroom endpoint
      // We'd need to search and filter, so just return null
      return null
    } catch (error) {
      this.log('error', `Failed to fetch restroom ${id}`, error)
      return null
    }
  }

  /**
   * Transform Refuge restroom to our canonical Place format
   */
  private transformRefugeRestroom(restroom: any): Place {
    return {
      id: `refuge_${restroom.id}`,
      name: restroom.name || 'Public Restroom',
      location: {
        lat: restroom.latitude,
        lon: restroom.longitude,
      },
      category: {
        primary: 'restroom',
        secondary: restroom.accessible ? ['accessible'] : [],
      },
      confidence: 0.8, // Community data
      // API doesn't provide these
      socials: [],
      websites: [],
      phones: [],
      emails: [],

      // Address info
      street: restroom.street,
      city: restroom.city,
      state: restroom.state,
      country: restroom.country,

      attributes: {
        accessible: restroom.accessible,
        unisex: restroom.unisex,
        changing_table: restroom.changing_table,
        directions: restroom.directions,
        comment: restroom.comment,
        upvote: restroom.upvote,
        downvote: restroom.downvote,
        created_at: restroom.created_at,
      },
      providers: {
        refuge: {
          externalId: restroom.id.toString(),
          raw: restroom,
        },
      },
    }
  }

  /**
   * Calculate distance between two points (Haversine formula)
   * Returns distance in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3 // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }
}
