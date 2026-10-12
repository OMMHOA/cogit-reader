import "server-only";
import { headSha, treeOf, blobText } from "./github";
import { parseBlocks, parseSections, headingText, type Block, type Section } from "./blocks";

// A book is a top-level directory of the books repo with a Hungarian translation file.
const HUN = /^([^/]+)\/[^/]+-HUN(?:-full)?\.md$/;

export type Book = {
  slug: string;
  path: string;
  title: string;
  src: string;
  blocks: Block[];
  sections: Section[];
};

const parsed = new Map<string, Book>();

async function load(slug: string, path: string, blobSha: string): Promise<Book> {
  const hit = parsed.get(blobSha);
  if (hit) return hit;
  const src = await blobText(blobSha);
  const blocks = parseBlocks(src);
  const first = blocks.find((b) => b.text.startsWith("#"));
  const book = {
    slug,
    path,
    title: first ? headingText(first.text.split("\n")[0]) : slug,
    src,
    blocks,
    sections: parseSections(blocks),
  };
  parsed.set(blobSha, book);
  if (parsed.size > 8) parsed.delete(parsed.keys().next().value!);
  return book;
}

export async function listBooks(): Promise<Book[]> {
  const tree = await treeOf(await headSha());
  const refs = tree.flatMap((e) => {
    const m = HUN.exec(e.path);
    return m ? [{ slug: m[1], path: e.path, sha: e.sha }] : [];
  });
  return Promise.all(refs.map((r) => load(r.slug, r.path, r.sha)));
}

export async function getBook(slug: string): Promise<Book | null> {
  return (await listBooks()).find((b) => b.slug === slug) ?? null;
}
