import type { PlaceProvider, SearchQuery, ProviderResult, Place } from '../providers/types.js'
import { LocalDatabaseProvider } from '../providers/local.provider.js'
import { GooglePlacesProvider } from '../providers/google.provider.js'
import { RefugeRestroomsProvider } from '../providers/refuge.provider.js'
import { BreweryProvider } from '../providers/brewery.provider.js'
import { cacheService } from './cache.service.js'
import { databaseService } from './database.service.js'
import { env } from '../config/env.js'

/**
 * Query orchestrator
 * Coordinates multiple providers, caching, result merging, and deduplication
 */
export class QueryOrchestrator {
  private providers: Map<string, PlaceProvider> = new Map()
  private providerLayerSlugMap: Record<string, string> = {
    'refuge': 'refugee-restroom',
    'brewery': 'brewery', // Implicitly handled by fallback
  }

  constructor() {
    // Always register local provider
    this.registerProvider(new LocalDatabaseProvider())

    // Register external providers if API keys are available
    if (env.GOOGLE_PLACES_API_KEY) {
      this.registerProvider(new GooglePlacesProvider())
    }

    // Refuge Restrooms (public API, no key needed)
    this.registerProvider(new RefugeRestroomsProvider())

    // Brewery (public API)
    this.registerProvider(new BreweryProvider())
  }

  /**
   * Register a new provider
   */
  registerProvider(provider: PlaceProvider): void {
    this.providers.set(provider.name, provider)
    console.log(`✅ Registered provider: ${provider.name}`)
  }

  /**
   * Search across providers with caching
   * Simple strategy: Query local database only for now
   */
  async search(query: SearchQuery): Promise<ProviderResult> {
    // Generate cache key from query parameters
    const cacheParams = {
      lat: query.location.lat,
      lon: query.location.lon,
      radius: query.location.radius || 1000,
      query: query.query || '',
      category: query.category || '',
      limit: query.limit || 20,
      offset: query.offset || 0,
    }

    // Check cache first
    const cached = await cacheService.getSearchResults(cacheParams)
    if (cached) {
      console.log('✅ Cache HIT for search query')
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          cached: true,
        },
      }
    }

    console.log('⚠️  Cache MISS for search query')

    // Query local provider
    const localProvider = this.providers.get('local')
    if (!localProvider) {
      throw new Error('Local provider not initialized')
    }

    const result = await localProvider.search(query)

    // NEW: Generic enrichment with all applicable providers
    const enrichedPlaces = await this.enrichWithProviders(
      result.places,
      query
    )

    const finalResult = {
      ...result,
      places: enrichedPlaces,
    }

    // Cache the result (5 minutes TTL)
    // await cacheService.setSearchResults(cacheParams, finalResult, 300)

    return finalResult
  }

  /**
   * Merge results from multiple providers and deduplicate
   */
  private async mergeResults(results: ProviderResult[], limit: number): Promise<ProviderResult> {
    // Flatten all places
    const allPlaces: Place[] = []
    let totalLatency = 0
    const providers: string[] = []

    results.forEach((result) => {
      allPlaces.push(...result.places)
      totalLatency += result.metadata.latency
      providers.push(result.provider)
    })

    // Deduplicate places
    const deduplicated = this.deduplicatePlaces(allPlaces)

    // Sort by combined score (confidence + proximity)
    const sorted = deduplicated.sort((a, b) => {
      const scoreA = this.calculatePlaceScore(a)
      const scoreB = this.calculatePlaceScore(b)
      return scoreB - scoreA
    })

    // Limit results
    const limited = sorted.slice(0, limit)

    return {
      provider: 'merged',
      places: limited,
      metadata: {
        count: limited.length,
        cached: false,
        latency: totalLatency,
        confidence: this.calculateAverageConfidence(limited),
        sources: providers,
      } as any,
    }
  }

  /**
   * Deduplicate places based on name and location similarity
   * Optimized with spatial bucketing: O(n log n) instead of O(n²)
   */
  private deduplicatePlaces(places: Place[]): Place[] {
    if (places.length === 0) return []

    // Step 1: Create spatial buckets (grid-based)
    // Each bucket is ~100m x 100m (0.001 degrees ≈ 111m)
    const bucketSize = 0.001
    const buckets = new Map<string, Place[]>()

    for (const place of places) {
      const bucketKey = this.getBucketKey(place.location.lat, place.location.lon, bucketSize)

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, [])
      }
      buckets.get(bucketKey)!.push(place)
    }

    // Step 2: Deduplicate within and across neighboring buckets
    const deduplicated: Place[] = []
    const processedIds = new Set<string>()

    for (const place of places) {
      if (processedIds.has(this.getPlaceFingerprint(place))) {
        continue
      }

      // Check nearby buckets (3x3 grid around current bucket)
      const nearbyPlaces = this.getNearbyPlaces(place, buckets, bucketSize)

      let merged = place
      let isDuplicate = false

      for (const nearby of nearbyPlaces) {
        const nearbyFingerprint = this.getPlaceFingerprint(nearby)

        if (processedIds.has(nearbyFingerprint)) {
          continue
        }

        if (this.arePlacesSimilar(place, nearby)) {
          // Merge and mark as processed
          merged = this.mergePlaces(
            merged.confidence > nearby.confidence ? merged : nearby,
            merged.confidence > nearby.confidence ? nearby : merged
          )
          processedIds.add(nearbyFingerprint)
          isDuplicate = true
        }
      }

      if (!isDuplicate || merged === place) {
        processedIds.add(this.getPlaceFingerprint(place))
        deduplicated.push(merged)
      }
    }

    return deduplicated
  }

  /**
   * Get bucket key for spatial indexing
   */
  private getBucketKey(lat: number, lon: number, bucketSize: number): string {
    const latBucket = Math.floor(lat / bucketSize)
    const lonBucket = Math.floor(lon / bucketSize)
    return `${latBucket},${lonBucket}`
  }

  /**
   * Get nearby places from surrounding buckets (3x3 grid)
   */
  private getNearbyPlaces(
    place: Place,
    buckets: Map<string, Place[]>,
    bucketSize: number
  ): Place[] {
    const nearby: Place[] = []
    const { lat, lon } = place.location

    // Check 3x3 grid of buckets
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const bucketKey = this.getBucketKey(
          lat + dLat * bucketSize,
          lon + dLon * bucketSize,
          bucketSize
        )
        if (buckets.has(bucketKey)) {
          nearby.push(...buckets.get(bucketKey)!)
        }
      }
    }

    return nearby
  }

  /**
   * Generate unique fingerprint for a place (for Set lookups)
   */
  private getPlaceFingerprint(place: Place): string {
    return `${place.name.toLowerCase()}_${place.location.lat.toFixed(6)}_${place.location.lon.toFixed(6)}`
  }

  /**
   * Check if two places are likely the same
   */
  private arePlacesSimilar(a: Place, b: Place): boolean {
    // 1. Name similarity (Levenshtein distance)
    const nameSimilarity = this.stringSimilarity(
      a.name.toLowerCase(),
      b.name.toLowerCase()
    )

    // 2. Geographic proximity (within 50 meters)
    const distance = this.calculateDistance(
      a.location.lat,
      a.location.lon,
      b.location.lat,
      b.location.lon
    )

    // 3. Category match
    const categoryMatch = a.category.primary === b.category.primary

    // Consider similar if name is very similar OR (name similar + close distance + same category)
    return (
      nameSimilarity > 0.9 ||
      (nameSimilarity > 0.7 && distance < 50 && categoryMatch)
    )
  }

  /**
   * Merge two places (combine data from both)
   */
  private mergePlaces(primary: Place, secondary: Place): Place {
    return {
      ...primary,
      socials: [...new Set([...(primary.socials || []), ...(secondary.socials || [])])],
      websites: [...new Set([...(primary.websites || []), ...(secondary.websites || [])])],
      attributes: {
        ...secondary.attributes,
        ...primary.attributes, // Primary takes precedence
      },
      providers: {
        ...secondary.providers,
        ...primary.providers,
      },
    }
  }

  /**
   * Calculate place score for ranking
   */
  private calculatePlaceScore(place: Place): number {
    // Factors: confidence (0-1), distance (lower is better)
    let score = place.confidence || 0.5

    // Boost by inverse distance (closer = higher score)
    if (place.distance) {
      const distanceScore = 1 - Math.min(place.distance / 5000, 1) // Normalize to 5km
      score += distanceScore * 0.3 // 30% weight on distance
    }

    return score
  }

  /**
   * Calculate average confidence
   */
  private calculateAverageConfidence(places: Place[]): number {
    if (places.length === 0) return 0
    const sum = places.reduce((acc, p) => acc + (p.confidence || 0.5), 0)
    return sum / places.length
  }

  /**
   * String similarity (simple Levenshtein-based)
   */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1.0
    if (a.length === 0 || b.length === 0) return 0

    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a

    if (longer.includes(shorter)) return 0.8

    const distance = this.levenshteinDistance(a, b)
    return 1 - distance / Math.max(a.length, b.length)
  }

  /**
   * Levenshtein distance
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = []

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i]
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }

    return matrix[b.length][a.length]
  }

  /**
   * Calculate distance between two points (meters)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3
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

  /**
   * Timeout helper
   */
  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    )
  }

  /**
   * Get a single place by ID
   */
  async getPlace(id: string): Promise<any | null> {
    // Check cache first
    const cached = await cacheService.getPlace(id)
    if (cached) {
      console.log(`✅ Cache HIT for place: ${id}`)
      return cached
    }

    console.log(`⚠️  Cache MISS for place: ${id}`)

    // Try all providers
    for (const provider of this.providers.values()) {
      try {
        const place = await provider.getPlace(id)
        if (place) {
          // Cache for 30 minutes
          await cacheService.setPlace(id, place, 1800)
          return place
        }
      } catch (error) {
        console.error(`[Orchestrator] ${provider.name} getPlace failed:`, error)
      }
    }

    return null
  }

  /**
   * Health check for all providers
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [name, provider] of this.providers) {
      results[name] = await provider.healthCheck()
    }

    return results
  }

  /**
   * Get Google Places autocomplete suggestions
   */
  async autocomplete(input: string, location?: { lat: number; lon: number }): Promise<any[]> {
    const googleProvider = this.providers.get('google') as GooglePlacesProvider | undefined

    if (!googleProvider) {
      throw new Error('Google Places provider not available')
    }

    return await googleProvider.autocomplete(input, location)
  }

  /**
   * Resolve a POI (find or create canonical record + enrich with Mapier data)
   * TODO: Implement full resolution logic:
   * - Check if POI exists by google_place_id
   * - Check by coordinates (fuzzy match within 50m)
   * - Create new POI if not found
   * - Enrich with tags, user lists, friends, AI blurb
   */
  async resolvePOI(data: {
    google_place_id?: string
    lat?: number
    lon?: number
    name?: string
    category?: string
  }): Promise<any> {
    // Placeholder implementation
    return {
      poi_id: `mapier_${Date.now()}`,
      google_place_id: data.google_place_id,
      name: data.name || 'Unknown Place',
      location: {
        lat: data.lat || 0,
        lon: data.lon || 0,
      },
      category: {
        primary: data.category || 'unknown',
      },
      mapier_metadata: {
        enriched: true,
        tags: [],
        user_lists: [],
        friends_visited: [],
      },
    }
  }

  // -------------------------------------------------------------------------
  // Enrichment Logic (Generic Providers)
  // -------------------------------------------------------------------------

  /**
   * Enrich local places with data from external providers
   */
  private async enrichWithProviders(
    places: Place[],
    query: SearchQuery
  ): Promise<Place[]> {
    // 1. Identify which providers to query
    // Exclude 'local' (already queried) and 'google' (different logic)
    const externalProviders = Array.from(this.providers.values()).filter(p =>
      p.name !== 'local' && p.name !== 'google'
    )

    const newlyDiscoveredPlaces: Place[] = []

    // 2. Query each provider in parallel
    for (const provider of externalProviders) {
      try {
        // Use the provider-specific search but apply defaults if needed
        // Note: The provider implementations should handle logic like "only search if category valid"
        const result = await provider.search({
          ...query,
          location: { ...query.location, radius: query.location.radius || 1000 },
          // Limit enrichment searches to avoid spamming APIs
          limit: 50
        })

        console.log(`[Enrichment] Provider '${provider.name}' returned ${result.places.length} places`)

        // 3. Link results to local POIs and collect them
        for (const externalPlace of result.places) {
          try {
            const linkedPOI = await this.linkExternalPlaceToPOI(externalPlace, provider.name)
            newlyDiscoveredPlaces.push(linkedPOI)
          } catch (linkError) {
            console.error(`[Enrichment] Failed to link place from ${provider.name}:`, linkError)
          }
        }
      } catch (error) {
        console.error(`[Enrichment] Provider '${provider.name}' failed during enrichment:`, error)
        // Log error but continue
      }
    }

    // Combine original matches with new/linked matches
    // Deduplicate logic handles the overlap (if matchedPOI was already in 'places')
    const combinedPlaces = [...places, ...newlyDiscoveredPlaces]
    const uniquePlaces = this.deduplicatePlaces(combinedPlaces)

    // 4. Reload places with all attached layers
    return this.loadPlacesWithLayers(uniquePlaces)
  }

  /**
   * Link an external provider place to a Mapier POI
   */
  private async linkExternalPlaceToPOI(externalPlace: Place, providerName: string): Promise<Place> {
    // 1. Resolve layer slug
    const layerSlug = this.providerLayerSlugMap[providerName] || providerName

    // 2. Try to fuzzy match an existing POI in our DB
    const matchedPOI = await databaseService.fuzzyMatchPOI({
      lat: externalPlace.location.lat,
      lon: externalPlace.location.lon,
      name: externalPlace.name,
      radius: 50, // 50 meters tolerance
    })

    if (!matchedPOI) {
      // 3a. No match - create new POI
      const newPOI = await databaseService.createPOI({
        name: externalPlace.name,
        location: externalPlace.location,
        category: externalPlace.category,
        confidence: 0.8 // Set a good default confidence for provider data
        // Other fields like socials/websites are copied if present in creation logic
      })

      // Link new POI to provider layer
      await databaseService.createPlaceLayer({
        place_id: newPOI.id,
        layer_slug: layerSlug,
        external_id: externalPlace.providers && externalPlace.providers[providerName] ? externalPlace.providers[providerName].externalId : undefined,
        layer_data: externalPlace.attributes,
      })
      return newPOI
    }

    // 3b. Match found - check if link exists
    const existingLayer = await databaseService.getPlaceLayer(matchedPOI.id, layerSlug)

    if (!existingLayer) {
      // Link existing POI to this provider's layer
      await databaseService.createPlaceLayer({
        place_id: matchedPOI.id,
        layer_slug: layerSlug,
        external_id: externalPlace.providers && externalPlace.providers[providerName] ? externalPlace.providers[providerName].externalId : undefined,
        layer_data: externalPlace.attributes,
      })
    } else {
      // 4. Update data if changed
      if (this.hasLayerDataChanged(existingLayer.layer_data, externalPlace.attributes)) {
        await databaseService.updatePlaceLayer(existingLayer.id, {
          layer_data: externalPlace.attributes,
          last_synced: new Date(),
        })
      } else {
        // Just touch timestamp
        await databaseService.touchPlaceLayer(existingLayer.id)
      }
    }

    return matchedPOI
  }

  /**
   * Check if layer data has changed
   */
  private hasLayerDataChanged(existing: any, incoming: any): boolean {
    // Simple deep strict equality check could be risky with order,
    // but for now let's compare JSON strings of keys for simplicity or use a loop.
    // Ideally we might want Lodash isEqual, but here is a simple shallow+ version.

    const existingKeys = Object.keys(existing || {})
    const incomingKeys = Object.keys(incoming || {})

    if (existingKeys.length !== incomingKeys.length) return true

    for (const key of incomingKeys) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(incoming[key])) {
        return true
      }
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Database Operations (Delegated to DatabaseService)
  // -------------------------------------------------------------------------

  /**
   * Load and attach layer data to places
   */
  private async loadPlacesWithLayers(places: Place[]): Promise<Place[]> {
    if (places.length === 0) return []

    const placeIds = places.map((p) => p.id)
    const layersMap = await databaseService.loadPlaceLayers(placeIds)

    return places.map((place) => {
      const layers = layersMap.get(place.id)
      if (!layers) return place

      // Merge layer data into place
      // We can put it in 'attributes.layers' or a dedicated field
      return {
        ...place,
        attributes: {
          ...place.attributes,
          layers: layers,
        },
      }
    })
  }
}

// Singleton instance
export const orchestrator = new QueryOrchestrator()
