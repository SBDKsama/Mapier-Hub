import { tool } from 'ai'
import { z } from 'zod'
import { orchestrator } from './orchestrator.js'

/**
 * Mapier Tool Definitions
 * Each tool represents a capability that the LLM can invoke
 */

/**
 * Search for accessible and gender-neutral restrooms
 */
export const searchRestroomsTool = tool({
  description:
    'Search for accessible and gender-neutral restrooms near a location. Use this when users ask about restrooms, bathrooms, or toilets. IMPORTANT: You must provide the user\'s latitude and longitude coordinates.',
  inputSchema: z.object({
    lat: z.number().describe('Latitude of search location - use the user\'s current latitude from the system message'),
    lon: z.number().describe('Longitude of search location - use the user\'s current longitude from the system message'),
    radius: z.number().optional().describe('Search radius in meters (default: 2000)'),
    limit: z.number().optional().describe('Maximum number of results (default: 10)'),
  }),
  execute: async ({ lat, lon, radius = 2000, limit = 10 }) => {
    console.log(`[Tool: search_restrooms] lat=${lat}, lon=${lon}, radius=${radius}m`)

    // Validate coordinates
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return {
        error: 'Invalid or missing coordinates. Please provide valid latitude and longitude.',
        count: 0,
        restrooms: [],
      }
    }

    // Get refuge provider
    const refugeProvider = (orchestrator as any).providers.get('refuge')
    if (!refugeProvider) {
      return { error: 'Refuge Restrooms provider not available', count: 0, restrooms: [] }
    }

    try {
      // Search for restrooms
      const result = await refugeProvider.search({
        location: { lat, lon, radius },
        query: 'restroom',
        limit,
      })

      return {
        count: result.places.length,
        restrooms: result.places.map((place: any) => ({
          name: place.name,
          distance: place.distance,
          accessible: place.attributes.accessible,
          unisex: place.attributes.unisex,
          changing_table: place.attributes.changing_table,
          street: place.attributes.street,
          city: place.attributes.city,
          directions: place.attributes.directions,
        })),
      }
    } catch (error) {
      return {
        error: `Failed to search restrooms: ${error instanceof Error ? error.message : 'Unknown error'}`,
        count: 0,
        restrooms: [],
      }
    }
  },
})

/**
 * Search for breweries and beer locations
 */
export const searchBreweriesTool = tool({
  description:
    'Search for breweries, brewpubs, and beer locations near a location. Use this when users ask about breweries, beer, or where to get a drink. IMPORTANT: You must provide the user\'s latitude and longitude coordinates.',
  inputSchema: z.object({
    lat: z.number().describe("Latitude of search location - use the user's current latitude from the system message"),
    lon: z.number().describe("Longitude of search location - use the user's current longitude from the system message"),
    type: z.enum(['micro', 'nano', 'regional', 'brewpub', 'large', 'planning', 'bar', 'contract', 'proprietor', 'closed']).optional().describe('Filter by type of brewery'),
    name: z.string().optional().describe('Filter by name of the brewery'),
    limit: z.number().optional().describe('Maximum number of results (default: 20)'),
  }),
  execute: async ({ lat, lon, type, name, limit = 20 }) => {
    console.log(`[Tool: search_breweries] lat=${lat}, lon=${lon}, type=${type}, name=${name}, limit=${limit}`)

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return {
        error: 'Invalid or missing coordinates. Please provide valid latitude and longitude.',
        count: 0,
        breweries: [],
      }
    }

    // Get brewery provider
    // Note: orchestrator.providers is private, so we access it via 'any' cast as done in existing code
    const breweryProvider = (orchestrator as any).providers.get('brewery')
    if (!breweryProvider) {
      return { error: 'Brewery provider not available', count: 0, breweries: [] }
    }

    try {
      const result = await breweryProvider.search({
        location: { lat, lon },
        query: name,
        category: type || 'brewery',
        limit,
      })

      return {
        count: result.places.length,
        breweries: result.places.map((place: any) => ({
          name: place.name,
          distance: place.distance,
          type: place.attributes.type,
          street: place.attributes.street,
          city: place.attributes.city,
          website: place.websites?.[0] || null,
        })),
      }
    } catch (error) {
      return {
        error: `Failed to search breweries: ${error instanceof Error ? error.message : 'Unknown error'}`,
        count: 0,
        breweries: [],
      }
    }
  },
})

/**
 * TODO: Add more tools here:
 * - searchPOIs: General POI search (restaurants, cafes, etc.)
 * - resolveAddress: Convert address to coordinates
 * - getAreaStats: Get statistics about an area (rent prices, demographics, etc.)
 * - findSimilarPOIs: Find POIs similar to a given one
 * - getRouteInfo: Get directions and transit info
 */

/**
 * All available tools for the AI service
 * Add new tools to this object to make them available to the LLM
 */
export const mapierTools = {
  search_restrooms: searchRestroomsTool,
  search_breweries: searchBreweriesTool,
  // Future tools go here
}
