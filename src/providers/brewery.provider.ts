import axios from 'axios'
import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'

/**
 * Open Brewery DB Provider
 * Integrates Open Brewery DB API
 * API Docs: https://www.openbrewerydb.org/documentation
 */
export class BreweryProvider extends BaseProvider {
    private readonly baseURL = 'https://api.openbrewerydb.org/v1'

    constructor() {
        super({
            name: 'brewery',
            priority: 4,
            timeout: 5000,
            enabled: true,
        })

        this.log('info', 'Brewery provider initialized')
    }

    private readonly validTypes = [
        'micro',
        'nano',
        'regional',
        'brewpub',
        'large',
        'planning',
        'bar',
        'contract',
        'proprietor',
        'closed',
    ]

    async search(query: SearchQuery): Promise<ProviderResult> {
        // Check if the category matches a valid brewery type
        const typeMatch = query.category && this.validTypes.find(t => query.category!.includes(t))

        // Only search if looking for breweries or a specific valid type
        const isBreweryQuery =
            query.category?.includes('brewery') ||
            query.category?.includes('bar') ||
            query.query?.toLowerCase().includes('beer') ||
            query.query?.toLowerCase().includes('brew') ||
            !!typeMatch

        const isGeneralBrowse = !query.category && !query.query

        if (!isBreweryQuery && !query.query && !isGeneralBrowse) {
            // If they specifically asked for 'restroom' or 'park' (and not brewery), return empty.
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
                const params: any = {
                    by_dist: `${query.location.lat},${query.location.lon}`,
                    per_page: query.limit || 20,
                }

                if (typeMatch) {
                    params.by_type = typeMatch
                }

                if (query.query) {
                    params.by_name = query.query
                }

                const response = await axios.get(`${this.baseURL}/breweries`, {
                    params,
                    timeout: this.timeout,
                })

                return response.data.map((item: any) => this.transformBrewery(item))
            } catch (error) {
                this.log('error', 'Brewery API search failed', error)
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
                confidence: 0.8, // Community-sourced data
            },
        }
    }

    async getPlace(id: string): Promise<Place | null> {
        try {
            // The ID we store is "brewery_{id}", so strip prefix
            const realId = id.replace('brewery_', '')
            const response = await axios.get(`${this.baseURL}/breweries/${realId}`, {
                timeout: this.timeout
            })
            return this.transformBrewery(response.data)
        } catch (error) {
            this.log('error', `Failed to fetch brewery ${id}`, error)
            return null
        }
    }

    private transformBrewery(brewery: any): Place {
        return {
            id: `brewery_${brewery.id}`,
            name: brewery.name,
            location: {
                lat: parseFloat(brewery.latitude),
                lon: parseFloat(brewery.longitude),
            },
            category: {
                primary: 'brewery',
                secondary: [brewery.brewery_type],
            },
            confidence: 0.8,
            websites: brewery.website_url ? [brewery.website_url] : [],
            attributes: {
                type: brewery.brewery_type,
                street: brewery.street,
                city: brewery.city,
                state: brewery.state,
                phone: brewery.phone,
            },
            providers: {
                brewery: {
                    externalId: brewery.id,
                    raw: brewery
                }
            }
        }
    }
}
