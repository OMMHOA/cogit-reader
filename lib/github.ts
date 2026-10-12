import "server-only";

// The books repo through the GitHub API. Reads are cached in memory by Git object id (a commit's
// tree, a file's blob), which never changes, so only the branch head is fetched on every request.

const API = process.env.GITHUB_API_URL || "https://api.github.com";
const REPO = process.env.GITHUB_REPO || "OMMHOA/islamic-books-hun";
export const BRANCH = process.env.GITHUB_BRANCH || "master";

async function gh(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return res;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await gh(path, init);
  if (!res.ok) throw new Error(`GitHub ${init.method || "GET"} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const cache = new Map<string, unknown>();
function remember<T>(key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return value;
}

export async function headSha(): Promise<string> {
  const ref = await json<{ object: { sha: string } }>(`/git/ref/heads/${BRANCH}`);
  return ref.object.sha;
}

export type TreeEntry = { path: string; sha: string; type: string };

// Every file of a commit, with its blob id.
export async function treeOf(commitSha: string): Promise<TreeEntry[]> {
  const key = `tree:${commitSha}`;
  if (cache.has(key)) return cache.get(key) as TreeEntry[];
  const commit = await json<{ tree: { sha: string } }>(`/git/commits/${commitSha}`);
  const tree = await json<{ tree: TreeEntry[]; truncated: boolean }>(`/git/trees/${commit.tree.sha}?recursive=1`);
  return remember(key, tree.tree.filter((e) => e.type === "blob"));
}

export async function blobText(blobSha: string): Promise<string> {
  const key = `blob:${blobSha}`;
  if (cache.has(key)) return cache.get(key) as string;
  const res = await gh(`/git/blobs/${blobSha}`, { raw: true });
  if (!res.ok) throw new Error(`GitHub blob ${blobSha}: ${res.status}`);
  return remember(key, await res.text());
}

// One commit on the branch that replaces one file. Returns the new commit id, or null when the
// branch moved since `parentSha` (the caller re-reads and tries again).
export async function commitFile(opts: {
  parentSha: string;
  path: string;
  content: string;
  message: string;
  author: { name: string; email: string };
}): Promise<string | null> {
  const parent = await json<{ tree: { sha: string } }>(`/git/commits/${opts.parentSha}`);
  const tree = await json<{ sha: string }>(`/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: [{ path: opts.path, mode: "100644", type: "blob", content: opts.content }],
    }),
  });
  const commit = await json<{ sha: string }>(`/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: opts.message,
      tree: tree.sha,
      parents: [opts.parentSha],
      author: { ...opts.author, date: new Date().toISOString() },
    }),
  });
  const res = await gh(`/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (res.status === 422) return null; // not a fast-forward: someone pushed meanwhile
  if (!res.ok) throw new Error(`GitHub update ref: ${res.status} ${await res.text()}`);
  return commit.sha;
}
