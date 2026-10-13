import "server-only";
import { headSha, treeOf, blobText } from "./github";
import { parseBlocks, parseSections, headingText, type Block, type Section } from "./blocks";

// A book is a top-level directory of the books repo with a Hungarian translation file; the
// English and Arabic files next to it (…-ENG.md, …-AR-full.md) are its other versions.
const HUN = /^([^/]+)\/[^/]+-HUN(?:-full)?\.md$/;
const OTHER = /^([^/]+)\/[^/]+-(ENG|AR)(?:-full)?\.md$/;

export type Lang = "en" | "ar";

export type Book = {
  slug: string;
  path: string;
  sha: string; // of the Hungarian file
  title: string;
  src: string;
  blocks: Block[];
  sections: Section[];
  versions: Partial<Record<Lang, { path: string; sha: string }>>;
};

const parsed = new Map<string, Omit<Book, "versions">>();

async function load(slug: string, path: string, blobSha: string): Promise<Omit<Book, "versions">> {
  const hit = parsed.get(blobSha);
  if (hit) return hit;
  const src = await blobText(blobSha);
  const blocks = parseBlocks(src);
  const first = blocks.find((b) => b.text.startsWith("#"));
  const book = {
    slug,
    path,
    sha: blobSha,
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
  const versions = new Map<string, Book["versions"]>();
  for (const e of tree) {
    const m = OTHER.exec(e.path);
    if (!m) continue;
    const v = versions.get(m[1]) ?? {};
    v[m[2] === "ENG" ? "en" : "ar"] ??= { path: e.path, sha: e.sha };
    versions.set(m[1], v);
  }
  const refs = tree.flatMap((e) => {
    const m = HUN.exec(e.path);
    return m ? [{ slug: m[1], path: e.path, sha: e.sha }] : [];
  });
  return Promise.all(refs.map(async (r) => ({ ...(await load(r.slug, r.path, r.sha)), versions: versions.get(r.slug) ?? {} })));
}

export async function getBook(slug: string): Promise<Book | null> {
  return (await listBooks()).find((b) => b.slug === slug) ?? null;
}
