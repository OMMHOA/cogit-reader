"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideError } from "@/app/actions";
import type { ArabicError, View } from "@/lib/arabicErrors";

export const DECISION_LABEL: Record<View, string> = {
  slip: "Elírás: javítsuk jegyzet nélkül",
  fact: "Nem elírás: maradjon a jegyzettel",
};

// The two choices and an optional comment; both are saved with either button.
export default function ErrorDecision({ item }: { item: ArabicError }) {
  const [comment, setComment] = useState(item.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const decide = (decision: View | null) =>
    start(async () => {
      const r = await decideError({ id: item.id, decision, comment });
      if (r.error) return setError(r.error);
      setError(null);
      router.refresh();
    });

  if (item.applied)
    return (
      <p className="decided">
        <b>{item.decision ? DECISION_LABEL[item.decision] : "—"}</b>
        {item.comment && <span className="body"> · {item.comment}</span>}
        <span className="muted small"> · átvezetve a könyvbe</span>
      </p>
    );

  return (
    <div className="decide">
      <div className="buttons">
        {(["slip", "fact"] as const).map((v) => (
          <button key={v} aria-pressed={item.decision === v} disabled={pending} onClick={() => decide(v)}>
            {DECISION_LABEL[v]}
          </button>
        ))}
        {item.decision && (
          <button className="link" disabled={pending} onClick={() => decide(null)}>
            Visszavonás
          </button>
        )}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Megjegyzés (nem kötelező), például egy jobb javítás"
      />
      {item.decision && (
        <p className="hint">
          {item.decidedBy} döntött, {item.decidedAt}
          {comment !== (item.comment ?? "") && " · a megjegyzés a gombbal mentődik"}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
