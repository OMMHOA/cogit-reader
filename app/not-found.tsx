import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page narrow">
      <h1>Nincs ilyen oldal</h1>
      <p>
        <Link href="/">Vissza a könyvekhez</Link>
      </p>
    </div>
  );
}
