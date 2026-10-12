"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { reply, setStatus } from "@/app/actions";
import type { Thread } from "@/lib/threads";

const LABEL = { open: "Válaszra vár", answered: "Megválaszolva", resolved: "Lezárva" } as const;

export function StatusChip({ status }: { status: keyof typeof LABEL }) {
  return <span className={`chip ${status}`}>{LABEL[status]}</span>;
}

// Closed threads start collapsed under the paragraph; `link` (the questions page) shows them open.
export default function ThreadView({ thread, link }: { thread: Thread; link?: string }) {
  const [expanded, setExpanded] = useState(thread.status !== "resolved" || !!link);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!expanded)
    return (
      <button className="thread-collapsed" onClick={() => setExpanded(true)}>
        Lezárt beszélgetés · {thread.messages.length} üzenet
      </button>
    );

  const send = () =>
    start(async () => {
      const r = await reply({ threadId: thread.id, body: draft });
      if (r.error) return setError(r.error);
      setDraft("");
      setReplying(false);
      setError(null);
      router.refresh();
    });

  const toggle = () =>
    start(async () => {
      const r = await setStatus({ threadId: thread.id, status: thread.status === "resolved" ? "open" : "resolved" });
      if (r.error) return setError(r.error);
      if (thread.status !== "resolved" && !link) setExpanded(false);
      router.refresh();
    });

  return (
    <div className={`thread ${thread.status}`}>
      <div className="thread-head">
        <StatusChip status={thread.status} />
        {link && (
          <Link href={link} className="jump">
            Ugrás a bekezdéshez
          </Link>
        )}
      </div>
      {thread.quote && <p className="quote">{thread.quote}</p>}
      {thread.messages.map((m) => (
        <div key={m.id} className={m.isClaude ? "msg claude" : "msg"}>
          <div className="meta">
            <b>{m.author}</b> · {m.at}
          </div>
          <div className="body">{m.body}</div>
        </div>
      ))}
      {replying ? (
        <div className="form">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Válaszod…"
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <div className="buttons">
            <button className="primary" disabled={pending || !draft.trim()} onClick={send}>
              {pending ? "Küldés…" : "Küldés"}
            </button>
            <button onClick={() => setReplying(false)} disabled={pending}>
              Mégse
            </button>
          </div>
        </div>
      ) : (
        <div className="buttons">
          <button onClick={() => setReplying(true)}>Válasz</button>
          <button onClick={toggle} disabled={pending}>
            {thread.status === "resolved" ? "Újranyitás" : "Lezárás"}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </div>
  );
}
