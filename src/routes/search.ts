import { Hono } from 'hono'
import { z } from 'zod'
import { orchestrator } from '../services/orchestrator.js'
import { LocalDatabaseProvider } from '../providers/local.provider.js'
import { BoundedSearchQuery } from '../providers/types.js'
import { validateBody, searchQuerySchema } from '../middleware/validator.js'
import type { SearchQueryInput } from '../middleware/validator.js'

const search = new Hono<{
  Variables: {
    validatedData: unknown
  }
}>()

/**
 * POST /api/v1/search
 * Search for places based on location and filters
 */
const boundedSearchSchema = z.object({
  bounds: z.object({
    northeast: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }),
    southwest: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }),
  }),
  limit: z.number().min(1).max(200).default(50),
})

search.post('/bounds', validateBody(boundedSearchSchema), async (c) => {
  const query = c.get('validatedData') as BoundedSearchQuery
  const localProvider = orchestrator.providers.get('local') as LocalDatabaseProvider
  if (!localProvider) {
    return c.json({ success: false, error: 'Local provider not available' }, 503)
  }
  const result = await localProvider.searchBounds(query)
  return c.json({
    success: true,
    results: result.places,
    metadata: result.metadata,
  })
})

search.post('/', validateBody(searchQuerySchema), async (c) => {
  try {
    const query = c.get('validatedData') as SearchQueryInput

    // Execute search (just local for now)
    const result = await orchestrator.search(query)

    // Return response
    return c.json({
      success: true,
      results: result.places,
      metadata: {
        provider: result.provider,
        count: result.metadata.count,
        cached: result.metadata.cached,
        latency_ms: result.metadata.latency,
        confidence: result.metadata.confidence,
        sources: (result.metadata as any).sources,
      },
    })
  } catch (error) {
    console.error('[API] Search failed:', error)
    return c.json(
      {
        success: false,
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/v1/search/health
 * Health check for all providers
 */
search.get('/health', async (c) => {
  try {
    const health = await orchestrator.healthCheck()
    const allHealthy = Object.values(health).every((v) => v === true)

    return c.json(
      {
        success: true,
        status: allHealthy ? 'healthy' : 'degraded',
        providers: health,
      },
      allHealthy ? 200 : 503
    )
  } catch (error) {
    return c.json(
      {
        success: false,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default search
