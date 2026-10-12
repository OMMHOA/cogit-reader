#!/usr/bin/env node
// A stand-in for the parts of the GitHub API the site uses, backed by a local bare Git repo, so
// the site can be tested end to end without touching the real books repo.
//   node test/fake-github.mjs <bare-repo> <port>
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [repo, port = "4010"] = process.argv.slice(2);
const git = (args, opts = {}) =>
  execFileSync("git", ["--git-dir", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts }).trim();

const routes = [
  ["GET", /^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/, (m) => ({ object: { sha: git(["rev-parse", `refs/heads/${m[1]}`]) } })],
  ["GET", /^\/repos\/[^/]+\/[^/]+\/git\/commits\/(\w+)$/, (m) => ({ sha: m[1], tree: { sha: git(["rev-parse", `${m[1]}^{tree}`]) } })],
  [
    "GET",
    /^\/repos\/[^/]+\/[^/]+\/git\/trees\/(\w+)$/,
    (m) => ({
      truncated: false,
      tree: git(["ls-tree", "-r", m[1]])
        .split("\n")
        .map((l) => {
          const [meta, path] = l.split("\t");
          const [mode, type, sha] = meta.split(" ");
          return { path, mode, type, sha };
        }),
    }),
  ],
  ["GET", /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/(\w+)$/, (m) => ({ raw: execFileSync("git", ["--git-dir", repo, "cat-file", "blob", m[1]], { maxBuffer: 1 << 28 }) })],
  [
    "POST",
    /^\/repos\/[^/]+\/[^/]+\/git\/trees$/,
    (m, body) => {
      const dir = mkdtempSync(join(tmpdir(), "fakegh-"));
      const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
      try {
        git(["read-tree", body.base_tree], { env });
        for (const e of body.tree) {
          const sha = git(["hash-object", "-w", "--stdin"], { input: e.content });
          git(["update-index", "--add", "--cacheinfo", `${e.mode},${sha},${e.path}`], { env });
        }
        return { sha: git(["write-tree"], { env }) };
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  ],
  [
    "POST",
    /^\/repos\/[^/]+\/[^/]+\/git\/commits$/,
    (m, body) => {
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: body.author.name,
        GIT_AUTHOR_EMAIL: body.author.email,
        GIT_AUTHOR_DATE: body.author.date,
        GIT_COMMITTER_NAME: "Fake GitHub",
        GIT_COMMITTER_EMAIL: "fake@github.invalid",
      };
      const parents = body.parents.flatMap((p) => ["-p", p]);
      return { sha: git(["commit-tree", body.tree, ...parents, "-m", body.message], { env }) };
    },
  ],
  [
    "PATCH",
    /^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/,
    (m, body) => {
      const cur = git(["rev-parse", `refs/heads/${m[1]}`]);
      try {
        git(["merge-base", "--is-ancestor", cur, body.sha]);
      } catch {
        return { status: 422, message: "Update is not a fast forward" };
      }
      git(["update-ref", `refs/heads/${m[1]}`, body.sha, cur]);
      return { ref: `refs/heads/${m[1]}`, object: { sha: body.sha } };
    },
  ],
];

createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname);
      if (req.method !== method || !m) continue;
      try {
        const out = handler(m, data ? JSON.parse(data) : null);
        if (out.raw) {
          res.writeHead(200, { "Content-Type": "application/vnd.github.raw" });
          return res.end(out.raw);
        }
        res.writeHead(out.status ?? (method === "POST" ? 201 : 200), { "Content-Type": "application/json" });
        return res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: String(e.message).slice(0, 300) }));
      }
    }
    res.writeHead(404);
    res.end(JSON.stringify({ message: `no route ${req.method} ${url.pathname}` }));
  });
}).listen(Number(port), "127.0.0.1", () => console.log(`fake GitHub on :${port} for ${repo}`));
