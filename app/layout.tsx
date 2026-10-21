import type { Metadata } from "next";
import Link from "next/link";
import { Lora, Amiri } from "next/font/google";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

const lora = Lora({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], variable: "--font-book" });
const amiri = Amiri({ subsets: ["arabic"], weight: ["400", "700"], variable: "--font-arabic" });

export const metadata: Metadata = {
  title: { template: "%s · Lektorálás", default: "Lektorálás" },
  description: "Az iszlám könyvek magyar fordításainak közös javítása",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { member } = await currentUser();
  return (
    <html lang="hu" className={`${lora.variable} ${amiri.variable}`}>
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Lektorálás
          </Link>
          {member && (
            <nav>
              <Link href="/">Könyvek</Link>
              <Link href="/kerdesek">Kérdések</Link>
              <Link href="/jegyzetek">Jegyzeteim</Link>
              <Link href="/javitasok">Javítások</Link>
              <Link href="/hibak">Az eredeti hibái</Link>
              <Link href="/szabalyok">Szabályok</Link>
              <span className="me">
                <Link href="/jelszo" title="Jelszó módosítása">
                  {member.name}
                </Link>
                <form action={logout}>
                  <button className="link">Kilépés</button>
                </form>
              </span>
            </nav>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
