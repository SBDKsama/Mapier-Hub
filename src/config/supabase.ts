import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

/**
 * Supabase client singleton
 * Uses service role key for backend operations (bypasses RLS)
 */
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false, // No session persistence in backend
      autoRefreshToken: false,
    },
  }
)

/**
 * Test Supabase connection
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    // const { data, error } = await supabase.from('places').select('count').limit(1).single()
    const { error } = await supabase
      .from('places')
      .select('id', { head: true }) // returns headers only, no row payload
      .limit(1)

    if (error) throw error

    console.log('✅ Supabase connection successful')
    return true
  } catch (error) {
    console.error('❌ Supabase connection failed:', error)
    return false
  }
}
