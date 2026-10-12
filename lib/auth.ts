import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabase } from "./supabase";

export type Member = { id: string; name: string; email: string };

// Signed in AND a member (app_metadata.member, set only by scripts/admin.mjs).
export const currentUser = cache(async (): Promise<{ member: Member | null; signedIn: boolean }> => {
  const sb = await supabase();
  const { data } = await sb.auth.getClaims();
  const c = data?.claims;
  if (!c) return { member: null, signedIn: false };
  if (c.app_metadata?.member !== true) return { member: null, signedIn: true };
  const email = String(c.email ?? "");
  return { member: { id: c.sub, name: String(c.user_metadata?.name || email), email }, signedIn: true };
});

export async function requireMember(): Promise<Member> {
  const { member, signedIn } = await currentUser();
  if (!member) redirect(signedIn ? "/nincs-hozzaferes" : "/belepes");
  return member;
}
