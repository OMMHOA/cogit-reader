import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Belépés" };

export default async function Login({ searchParams }: { searchParams: Promise<{ vissza?: string }> }) {
  if ((await currentUser()).member) redirect("/");
  const { vissza } = await searchParams;
  return (
    <div className="page narrow">
      <h1>Belépés</h1>
      <p className="muted">Az iszlám könyvek magyar fordításainak közös javítása. Belépni meghívással lehet.</p>
      <LoginForm back={vissza ?? ""} />
    </div>
  );
}
