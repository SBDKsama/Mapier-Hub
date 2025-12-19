import { supabase } from '../config/supabase.js'
import type { Place } from '../providers/types.js'

/**
 * Service to handle direct database writes and specific lookups
 */
export class DatabaseService {
    /**
     * Fuzzy match a POI in the database
     * Uses the existing search RPC or raw query to find a matching place
     */
    async fuzzyMatchPOI(criteria: {
        lat: number
        lon: number
        name: string
        radius: number
    }): Promise<Place | null> {
        // We can reuse the existing search RPC which is optimized for spatial + text
        const { data, error } = await supabase.rpc('search_places_nearby_v2', {
            search_lat: criteria.lat,
            search_lon: criteria.lon,
            radius_meters: criteria.radius,
            search_query: criteria.name,
            category_filter: null, // Don't restrict category for matching
            result_limit: 1, // We only need the best match
            result_offset: 0,
        })

        if (error) {
            console.error('[DatabaseService] fuzzyMatchPOI failed:', error)
            return null
        }

        if (!data || data.length === 0) {
            return null
        }

        const row = data[0]
        // Transform to Place
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
     * Create a new POI in the 'places' table
     */
    async createPOI(data: Partial<Place> & { name: string; location: { lat: number; lon: number } }): Promise<Place> {
        // Generate a determinisic ID if we have an external ID, otherwise random
        const newId = data.id || `mapier_${Date.now()}_${Math.random().toString(36).substring(7)}`

        // Construct DB record
        const dbRecord = {
            id: newId,
            name: data.name,
            primary_category: data.category?.primary || 'unknown',
            alternate_categories: data.category?.secondary || [],
            lon: data.location.lon,
            lat: data.location.lat,
            confidence: data.confidence || 0.8,

            // Contact & Status
            socials: data.socials || [],
            websites: data.websites || [],
            phones: data.phones || [],
            emails: data.emails || [],
            brand: data.brand || null,
            operating_status: data.operating_status || null,

            // Address Fields from location.address
            street: (data.location as any).address?.street || null,
            city: (data.location as any).address?.city || null,
            state: (data.location as any).address?.state || null,
            postcode: (data.location as any).address?.postalCode || null,
            country: (data.location as any).address?.country || null,

            // Metadata
            source_type: 'provider',
            // raw: data.attributes || {}, // Removed: Column does not exist in user DB
            updated_at: new Date().toISOString()
        }

        const { error } = await supabase.from('places').insert(dbRecord)

        if (error) {
            console.error('[DatabaseService] createPOI failed:', error)
            throw new Error(`Failed to create POI: ${error.message}`)
        }

        return {
            ...data,
            id: newId,
            category: data.category || { primary: 'unknown' },
            location: data.location,
            attributes: data.attributes || {},
        } as Place
    }

    /**
     * Create a link in 'place_layers'
     */
    async createPlaceLayer(data: {
        place_id: string
        layer_slug: string
        external_id?: string
        layer_data: any
    }): Promise<void> {
        // First get layer ID from slug
        const { data: layerData, error: layerError } = await supabase
            .from('layers')
            .select('id')
            .eq('slug', data.layer_slug)
            .single()

        if (layerError || !layerData) {
            throw new Error(`Layer not found: ${data.layer_slug}`)
        }

        const { error } = await supabase.from('place_layers').insert({
            place_id: data.place_id,
            layer_id: layerData.id,
            external_id: data.external_id,
            layer_data: data.layer_data,
            last_synced: new Date().toISOString(),
        })

        if (error) {
            throw new Error(`Failed to link place layer: ${error.message}`)
        }
    }

    /**
     * Get an existing place layer link
     */
    async getPlaceLayer(placeId: string, layerSlug: string): Promise<any | null> {
        const { data, error } = await supabase
            .from('place_layers')
            .select('*, layers!inner(slug)')
            .eq('place_id', placeId)
            .eq('layers.slug', layerSlug)
            .maybeSingle()

        if (error) {
            console.error('[DatabaseService] getPlaceLayer failed:', error)
            return null
        }

        return data
    }

    /**
     * Update a place layer
     */
    async updatePlaceLayer(id: string, data: { layer_data: any; last_synced: Date }): Promise<void> {
        const { error } = await supabase.from('place_layers').update({
            layer_data: data.layer_data,
            last_synced: data.last_synced.toISOString(),
        }).eq('id', id)

        if (error) {
            throw new Error(`Failed to update place layer: ${error.message}`)
        }
    }

    /**
     * Touch a place layer (update last_synced)
     */
    async touchPlaceLayer(id: string): Promise<void> {
        const { error } = await supabase.from('place_layers').update({
            last_synced: new Date().toISOString(),
        }).eq('id', id)

        if (error) {
            console.error('[DatabaseService] touchPlaceLayer failed:', error)
        }
    }

    /**
     * Load layer data for multiple places
     * Useful for efficient fetching after search
     */
    async loadPlaceLayers(placeIds: string[]): Promise<Map<string, any[]>> {
        if (placeIds.length === 0) return new Map()

        const { data, error } = await supabase
            .from('place_layers')
            .select('place_id, layer_data, layers(slug, name, icon_url)')
            .in('place_id', placeIds)

        const result = new Map<string, any[]>()

        if (error || !data) {
            console.error('[DatabaseService] loadPlaceLayers failed:', error)
            return result
        }

        for (const row of data) {
            const placesLayers = result.get(row.place_id) || []
            placesLayers.push({
                slug: (row.layers as any)?.slug,
                name: (row.layers as any)?.name,
                icon: (row.layers as any)?.icon_url,
                data: row.layer_data,
            })
            result.set(row.place_id, placesLayers)
        }

        return result
    }
}

export const databaseService = new DatabaseService()
