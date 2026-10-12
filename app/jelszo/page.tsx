"use client";

import { useActionState } from "react";
import { changePassword } from "../actions";

export default function Password() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <div className="page narrow">
      <h1>Jelszó módosítása</h1>
      {state.done ? (
        <p className="saved">Az új jelszó elmentve.</p>
      ) : (
        <form action={action} className="stack">
          <label>
            Új jelszó (legalább 8 karakter)
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Még egyszer
            <input name="again" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          {state.error && <p className="error">{state.error}</p>}
          <button className="primary" disabled={pending}>
            Mentés
          </button>
        </form>
      )}
    </div>
  );
}
