import { currentUser } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { loadOriginal } from "@/lib/originals";

// The English or Arabic text of a section, matched to its paragraphs: the chapter page fetches
// it when a proofreader asks for it (?nyelv=en|ar).
export async function GET(request: Request, { params }: { params: Promise<{ book: string; sec: string }> }) {
  if (!(await currentUser()).member) return Response.json({ error: "Jelentkezz be újra." }, { status: 401 });
  const { book: slug, sec } = await params;
  const lang = new URL(request.url).searchParams.get("nyelv");
  const book = await getBook(slug);
  const data =
    book && /^\d+$/.test(sec) && (lang === "en" || lang === "ar") ? await loadOriginal(book, Number(sec), lang) : null;
  return data ? Response.json(data) : Response.json({ error: "Ehhez nincs ilyen szöveg." }, { status: 404 });
}
