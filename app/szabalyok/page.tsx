import type { Metadata } from "next";
import { requireMember } from "@/lib/auth";
import { headSha, treeOf, blobText } from "@/lib/github";
import { renderText } from "@/lib/render";

export const metadata: Metadata = { title: "Szabályok" };

// The translation rules for proofreaders: a Hungarian summary of the conventions, kept in the
// books repo next to the books and read from the latest master like them.
const RULES = "FORDITASI-ELVEK.md";
// Arabic words in the text (the honorifics, the Arabic a rule renders), set in the book's Arabic
// font: the UI font shows them tiny or not at all.
const ARABIC = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]+(?: +[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]+)*/g;

export default async function Rules() {
  await requireMember();
  const file = (await treeOf(await headSha())).find((e) => e.path === RULES);
  if (!file) {
    return (
      <div className="page">
        <h1>A fordítás szabályai</h1>
        <p className="muted">Ezek még nincsenek leírva. Ha valamiben nem vagy biztos, kérdezz rá.</p>
      </div>
    );
  }
  const html = renderText(await blobText(file.sha)).replace(ARABIC, (m) => `<span lang="ar">${m}</span>`);
  return (
    <div className="page">
      <div className="rules" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
