import type { PlaceProvider, SearchQuery, ProviderResult, Place, ProviderConfig } from './types.js'

/**
 * Abstract base class for all place providers
 * Provides common functionality and enforces the provider interface
 */
export abstract class BaseProvider implements PlaceProvider {
  public readonly name: string
  public readonly priority: number
  public readonly timeout: number
  protected readonly config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
    this.name = config.name
    this.priority = config.priority
    this.timeout = config.timeout
  }

  /**
   * Search for places based on query parameters
   * Must be implemented by concrete providers
   */
  abstract search(query: SearchQuery): Promise<ProviderResult>

  /**
   * Get a single place by ID
   * Must be implemented by concrete providers
   */
  abstract getPlace(id: string): Promise<Place | null>

  /**
   * Check if the provider is healthy and accessible
   * Can be overridden by concrete providers
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Default implementation: try a simple search
      const result = await this.search({
        location: { lat: 0, lon: 0, radius: 100 },
        limit: 1,
      })
      return result.places.length >= 0 // Just check if it doesn't throw
    } catch (error) {
      console.error(`[${this.name}] Health check failed:`, error)
      return false
    }
  }

  /**
   * Helper to measure execution time
   */
  protected async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; latency: number }> {
    const start = performance.now()
    const result = await fn()
    const latency = Math.round(performance.now() - start)
    return { result, latency }
  }

  /**
   * Helper to normalize place data
   */
  protected normalizePlaceData(data: any): Partial<Place> {
    return {
      name: data.name || 'Unknown',
      location: {
        lat: data.lat || data.location?.lat || 0,
        lon: data.lon || data.location?.lon || 0,
      },
      category: {
        primary: data.primary_category || data.category?.primary || 'unknown',
        secondary: data.secondary_categories || data.category?.secondary,
      },
      confidence: data.confidence || 0.5,
      socials: data.socials || [],
      websites: data.websites || [],
      phones: data.phones || [],
      emails: data.emails || [],
      attributes: data.attributes || {},
    }
  }

  /**
   * Log provider activity (can be replaced with proper logger)
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, meta?: any) {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [${this.name}] [${level.toUpperCase()}] ${message}`, meta || '')
  }
}
