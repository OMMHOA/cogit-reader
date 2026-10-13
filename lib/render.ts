import "server-only";
import MarkdownIt from "markdown-it";
import type { Block } from "./blocks";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const num = (m: string) => [...m].map((c) => SUP.indexOf(c)).join("");

export type BlockView = { index: number; text: string; html: string; editable: boolean };

// Renders a section's blocks. Footnote markers in the text link to the notes under the
// section's „Lábjegyzetek” heading, and each note links back.
export function renderBlocks(blocks: Block[]): BlockView[] {
  let inNotes = false;
  return blocks.map((b) => {
    if (/^#{1,6}\s/.test(b.text)) inNotes = /^#{1,6}\s+Lábjegyzetek\s*$/.test(b.text);
    let html = md.render(b.text);
    if (inNotes && /^[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(b.text)) {
      html = html.replace(/^<p>([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_, m) => `<p><a class="fn" id="fn-${num(m)}" href="#fnref-${num(m)}">${m}</a>`);
    } else if (!inNotes) {
      html = html.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `<a class="fnref" id="fnref-${num(m)}" href="#fn-${num(m)}">${m}</a>`);
    }
    return { index: b.index, text: b.text, html, editable: !/^\s*([-*_])(\s*\1){2,}\s*$/.test(b.text) };
  });
}

// Plain Markdown, for the English and Arabic texts shown next to the paragraphs.
export const renderText = (text: string) => md.render(text);
