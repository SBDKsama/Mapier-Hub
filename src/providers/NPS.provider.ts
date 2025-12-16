import axios from 'axios'
import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'
import { env } from '../config/env.js'

/**
 * National Park Service Provider
 * Integrates NPS API
 * API Docs: https://www.nps.gov/subjects/developer/api-documentation.htm
 */
export class NPSProvider extends BaseProvider {
    private readonly baseURL = 'https://developer.nps.gov/api/v1'
    private readonly apiKey: string

    constructor() {
        super({
            name: 'nps',
            priority: 5,
            timeout: 5000,
            enabled: !!env.NPS_API_KEY,
        })

        this.apiKey = env.NPS_API_KEY || ''
        if (this.apiKey) {
            this.log('info', 'NPS provider initialized')
        } else {
            this.log('warn', 'NPS provider disabled: No API key provided')
        }
    }

    async search(query: SearchQuery): Promise<ProviderResult> {
        // If not enabled or specific query doesn't match park intent, skip
        // Note: NPS API is somewhat specific, so we might want to trigger it slightly more aggressively if we had unlimited quota,
        // but it's good to be conservative.
        // Triggers: "park", "visitor center", "campground", "monument", "historic"
        const validTriggers = ['park', 'visitor', 'camp', 'monument', 'historic', 'trail', 'forest']
        const hasTrigger = validTriggers.some(t =>
            query.query?.toLowerCase().includes(t) ||
            query.category?.toLowerCase().includes(t)
        )

        if (!this.apiKey || !hasTrigger) {
            return {
                provider: this.name,
                places: [],
                metadata: {
                    count: 0,
                    cached: false,
                    latency: 0,
                    confidence: 0.8
                }
            }
        }

        const { result, latency } = await this.measureTime(async () => {
            try {
                // NPS API supports searching by stateCode (bad for lat/lon) or 'q' query.
                // It doesn't strictly support lat/lon radius search in a simple way for all endpoints, 
                // but some endpoints like /parks might allow filtering. 
                // Actually, standard NPS API is metadata focused.
                // For this implementation, we will use the /parks endpoint with 'q' and 'limit'.

                const params: any = {
                    api_key: this.apiKey,
                    limit: query.limit || 20,
                    q: query.query
                }

                // If we had state codes, that would be better, but we only have lat/lon.
                // We'll rely on the text query primarily.

                const response = await axios.get(`${this.baseURL}/parks`, {
                    params,
                    timeout: this.timeout,
                })

                return response.data.data.map((item: any) => this.transformNPSPark(item))
            } catch (error) {
                this.log('error', 'NPS API search failed', error)
                return []
            }
        })

        return {
            provider: this.name,
            places: result,
            metadata: {
                count: result.length,
                cached: false,
                latency,
                confidence: 0.9, // authoritative source
            },
        }
    }

    async getPlace(id: string): Promise<Place | null> {
        if (!this.apiKey) return null

        try {
            // ID format: "nps_{parkCode}"
            const parkCode = id.replace('nps_', '')
            const response = await axios.get(`${this.baseURL}/parks`, {
                params: {
                    api_key: this.apiKey,
                    parkCode: parkCode
                },
                timeout: this.timeout
            })

            if (response.data.data && response.data.data.length > 0) {
                return this.transformNPSPark(response.data.data[0])
            }
            return null
        } catch (error) {
            this.log('error', `Failed to fetch NPS park ${id}`, error)
            return null
        }
    }

    private transformNPSPark(park: any): Place {
        // NPS returns latLong string like "lat:37.865101, long:-119.538329" sometimes, 
        // or latitude/longitude fields directly.
        let lat = 0
        let lon = 0

        if (park.latitude && park.longitude) {
            lat = parseFloat(park.latitude)
            lon = parseFloat(park.longitude)
        } else if (park.latLong) {
            // parse "lat:37..., long:-119..."
            // simpler regex or split
            try {
                const parts = park.latLong.split(',')
                const latPart = parts[0].split(':')[1]
                const longPart = parts[1].split(':')[1]
                lat = parseFloat(latPart)
                lon = parseFloat(longPart)
            } catch (e) {
                // ignore
            }
        }

        return {
            id: `nps_${park.parkCode}`,
            name: park.fullName,
            location: {
                lat,
                lon,
            },
            category: {
                primary: 'park',
                secondary: [park.designation],
            },
            confidence: 0.8,
            websites: park.url ? [park.url] : [],
            phones: park.contacts?.phoneNumbers?.[0]?.phoneNumber ? [park.contacts.phoneNumbers[0].phoneNumber] : [],
            emails: park.contacts?.emailAddresses?.[0]?.emailAddress ? [park.contacts.emailAddresses[0].emailAddress] : [],

            // NPS parks span states, but we can try to extract addresses if available
            // standard park obj has 'addresses' array

            attributes: {
                description: park.description,
                weatherInfo: park.weatherInfo,
                states: park.states,
            },
            providers: {
                nps: {
                    externalId: park.parkCode,
                    raw: park
                }
            }
        }
    }
}
