import { Client, PlaceInputType } from '@googlemaps/google-maps-services-js'
import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'
import { env } from '../config/env.js'

/**
 * Google Places Provider
 * Integrates Google Places API for POI search
 */
export class GooglePlacesProvider extends BaseProvider {
  private client: Client

  constructor() {
    super({
      name: 'google',
      priority: 2, // Lower priority than local (fallback)
      timeout: 3000, // 3 seconds
      enabled: !!env.GOOGLE_PLACES_API_KEY,
    })

    this.client = new Client({})

    if (!env.GOOGLE_PLACES_API_KEY) {
      this.log('warn', 'Google Places API key not configured. Provider disabled.')
    }
  }

  /**
   * Search for places using Google Places Nearby Search
   *
   * TODO: Implement data pipeline for Google Places results
   * When this API returns results, we should:
   * 1. Return results to client immediately (current behavior)
   * 2. Send results to a background data pipeline that:
   *    - Resolves Google POI info to enrich our local POI database
   *    - Ensures compliance with Google Places API ToS (no direct caching, only enrichment)
   *    - Updates our database with missing places or enhanced data
   */
  async search(query: SearchQuery): Promise<ProviderResult> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places API key not configured')
    }

    const { result, latency } = await this.measureTime(async () => {
      try {
        const response = await this.client.placesNearby({
          params: {
            location: {
              lat: query.location.lat,
              lng: query.location.lon,
            },
            radius: query.location.radius || 1000,
            keyword: query.query,
            type: this.mapCategoryToGoogleType(query.category),
            key: env.GOOGLE_PLACES_API_KEY!,
          },
          timeout: this.timeout,
        })

        if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
          throw new Error(`Google Places API error: ${response.data.status}`)
        }

        const places = response.data.results
          .slice(0, query.limit || 20)
          .map((place) => this.transformGooglePlace(place))

        return places
      } catch (error) {
        this.log('error', 'Google Places search failed', error)
        throw error
      }
    })

    this.log('info', `Found ${result.length} places from Google in ${latency}ms`)

    return {
      provider: this.name,
      places: result,
      metadata: {
        count: result.length,
        cached: false,
        latency,
        confidence: 0.9, // Google data is highly trusted
      },
    }
  }

  /**
   * Get place details by Google Place ID
   */
  async getPlace(id: string): Promise<Place | null> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      return null
    }

    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: id,
          key: env.GOOGLE_PLACES_API_KEY!,
        },
        timeout: this.timeout,
      })

      if (response.data.status !== 'OK') {
        return null
      }

      return this.transformGooglePlace(response.data.result as any)
    } catch (error) {
      this.log('error', `Failed to fetch place ${id}`, error)
      return null
    }
  }

  /**
   * Google Places Autocomplete
   * For fuzzy search / suggestions
   */
  async autocomplete(input: string, location?: { lat: number; lon: number }): Promise<any[]> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places API key not configured')
    }

    try {
      const response = await this.client.placeAutocomplete({
        params: {
          input,
          location: location ? { lat: location.lat, lng: location.lon } : undefined,
          radius: location ? 5000 : undefined,
          key: env.GOOGLE_PLACES_API_KEY!,
        },
        timeout: this.timeout,
      })

      if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Autocomplete API error: ${response.data.status}`)
      }

      return response.data.predictions.map((prediction) => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting?.main_text,
        secondaryText: prediction.structured_formatting?.secondary_text,
        types: prediction.types,
      }))
    } catch (error) {
      this.log('error', 'Google Autocomplete failed', error)
      throw error
    }
  }

  /**
   * Transform Google Place to our canonical Place format
   */
  private transformGooglePlace(googlePlace: any): Place {
    const location = googlePlace.geometry?.location || {}

    return {
      id: googlePlace.place_id || `google_${Date.now()}`,
      name: googlePlace.name || 'Unknown',
      location: {
        lat: typeof location.lat === 'function' ? location.lat() : location.lat || 0,
        lon: typeof location.lng === 'function' ? location.lng() : location.lng || 0,
      },
      category: {
        primary: this.mapGoogleTypeToCategory(googlePlace.types?.[0]),
        secondary: googlePlace.types?.slice(1, 3) || [],
      },
      confidence: 0.9, // Google data is reliable
      socials: [],
      websites: googlePlace.website ? [googlePlace.website] : [],
      attributes: {
        rating: googlePlace.rating,
        user_ratings_total: googlePlace.user_ratings_total,
        price_level: googlePlace.price_level,
        opening_hours: googlePlace.opening_hours,
        address: googlePlace.vicinity || googlePlace.formatted_address,
        phone: googlePlace.formatted_phone_number,
        photos: googlePlace.photos?.map((p: any) => ({
          reference: p.photo_reference,
          width: p.width,
          height: p.height,
        })),
      },
      providers: {
        google: {
          externalId: googlePlace.place_id,
          raw: googlePlace,
        },
      },
    }
  }

  /**
   * Map our category to Google Place type
   */
  private mapCategoryToGoogleType(category?: string): string | undefined {
    if (!category) return undefined

    const mapping: Record<string, string> = {
      cafe: 'cafe',
      restaurant: 'restaurant',
      bar: 'bar',
      park: 'park',
      gym: 'gym',
      hospital: 'hospital',
      pharmacy: 'pharmacy',
      bank: 'bank',
      atm: 'atm',
      gas_station: 'gas_station',
      hotel: 'lodging',
      museum: 'museum',
      library: 'library',
      school: 'school',
      restroom: 'restroom',
    }

    return mapping[category] || category
  }

  /**
   * Map Google type to our category
   */
  private mapGoogleTypeToCategory(googleType?: string): string {
    if (!googleType) return 'unknown'

    const mapping: Record<string, string> = {
      cafe: 'cafe',
      restaurant: 'restaurant',
      bar: 'bar',
      park: 'park',
      gym: 'gym',
      hospital: 'hospital',
      pharmacy: 'pharmacy',
      bank: 'bank',
      atm: 'atm',
      gas_station: 'gas_station',
      lodging: 'hotel',
      museum: 'museum',
      library: 'library',
      school: 'school',
      restroom: 'restroom',
    }

    return mapping[googleType] || googleType
  }
}
