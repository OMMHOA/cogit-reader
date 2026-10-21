import type { Metadata } from "next";

// The page itself is a client component, which can't name its title.
export const metadata: Metadata = { title: "Jelszó módosítása" };

export default function PasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
