import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnon)

export async function loadKey(key) {
  try {
    const { data, error } = await supabase
      .from('branch_ops')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error) throw error
    return data?.value ?? null
  } catch (e) {
    console.warn('Supabase load error:', e.message)
    return null
  }
}

export async function saveKey(key, value) {
  try {
    const { error } = await supabase
      .from('branch_ops')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    return true
  } catch (e) {
    console.warn('Supabase save error:', e.message)
    return false
  }
}
