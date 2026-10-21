import type { Metadata } from "next";
import { logout } from "../actions";

export const metadata: Metadata = { title: "Nincs hozzáférésed" };

export default function NoAccess() {
  return (
    <div className="page narrow">
      <h1>Nincs hozzáférésed</h1>
      <p>Ezzel a fiókkal nem lehet belépni a lektoráláshoz. Ha szerinted ez hiba, szólj a fordítónak.</p>
      <form action={logout}>
        <button>Kilépés</button>
      </form>
    </div>
  );
}
