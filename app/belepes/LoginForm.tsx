"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm({ back }: { back: string }) {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="vissza" value={back} />
      <label>
        E-mail-cím
        <input name="email" type="email" autoComplete="username" defaultValue={state.email} required />
      </label>
      <label>
        Jelszó
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={pending}>
        {pending ? "Belépés…" : "Belépés"}
      </button>
    </form>
  );
}
