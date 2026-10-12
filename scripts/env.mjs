import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Settings from the environment, falling back to this repo's .env.local (or $ENV_FILE).
export function env() {
  const file = process.env.ENV_FILE || new URL("../.env.local", import.meta.url).pathname;
  const vars = {};
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  return { ...vars, ...process.env };
}

// Supabase with the secret key: bypasses row-level security. Local use only.
export function adminClient() {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SECRET_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (.env.local).");
    process.exit(1);
  }
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function die(msg) {
  console.error(msg);
  process.exit(1);
}
