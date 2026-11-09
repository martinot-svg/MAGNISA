/**
 * Realtime subscriptions must carry the authenticated JWT before they are
 * created. Without it, Postgres validates filters as anon and rejects private
 * notification columns such as recipient_user_id.
 */
export async function ensureRealtimeAuth(supabase: any): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (error || !accessToken) return false;
  supabase.realtime.setAuth(accessToken);
  return true;
}
