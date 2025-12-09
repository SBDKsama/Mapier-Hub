import { Hono } from 'hono'
import { LocalDatabaseProvider } from '../providers/local.provider.js'
import { RefugeRestroomsProvider } from '../providers/refuge.provider.js'
import { GooglePlacesProvider } from '../providers/google.provider.js'
import { BreweryProvider } from '../providers/brewery.provider.js'

const debug = new Hono()

/**
 * POST /api/v1/debug/local
 * Test local provider directly (bypass orchestrator)
 */
debug.post('/local', async (c) => {
  try {
    const body = await c.req.json()

    const localProvider = new LocalDatabaseProvider()
    const result = await localProvider.search(body)

    return c.json({
      success: true,
      result,
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/v1/debug/refuge
 * Test Refuge Restrooms provider directly
 */
debug.post('/refuge', async (c) => {
  try {
    const body = await c.req.json()

    const refugeProvider = new RefugeRestroomsProvider()
    const result = await refugeProvider.search(body)

    return c.json({
      success: true,
      result,
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/v1/debug/google
 * Test Google Places provider directly
 */
debug.post('/google', async (c) => {
  try {
    const body = await c.req.json()

    const googleProvider = new GooglePlacesProvider()
    const result = await googleProvider.search(body)

    return c.json({
      success: true,
      result,
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/v1/debug/brewery
 * Test Brewery provider directly
 */
debug.post('/brewery', async (c) => {
  try {
    const body = await c.req.json()

    const breweryProvider = new BreweryProvider()
    const result = await breweryProvider.search(body)

    return c.json({
      success: true,
      result,
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default debug
