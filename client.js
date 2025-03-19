import { createClient } from '@supabase/supabase-js';
const supabaseUrl = String(process.env.SUPABASE_URL);
const serviceKey = String(process.env.SERVICE_KEY);

export const supabase = createClient(supabaseUrl, serviceKey);
