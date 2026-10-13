import { wordDiff } from "@/lib/blocks";
import type { EditStatus } from "@/lib/edits";

export const EDIT_LABEL: Record<EditStatus, string> = {
  pending: "Ellenőrzésre vár",
  kept: "Rendben",
  reverted: "Visszaállítva",
};

export function EditChip({ status }: { status: EditStatus }) {
  return <span className={`chip ${status}`}>{EDIT_LABEL[status]}</span>;
}

// An edit as a word diff: the removed words struck through, the new ones highlighted.
export function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="diff">
      {wordDiff(before, after).map((p, i) =>
        p.kind === "same" ? <span key={i}>{p.text}</span> : p.kind === "del" ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>,
      )}
    </p>
  );
}
