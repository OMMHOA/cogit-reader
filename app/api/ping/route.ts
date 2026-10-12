import { createClient } from "@supabase/supabase-js";

// Hit daily by the Vercel cron (vercel.json): a free Supabase project pauses after a week idle.
export async function GET() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await sb.rpc("ping");
  return Response.json({ ok: !error }, { status: error ? 500 : 200 });
}
