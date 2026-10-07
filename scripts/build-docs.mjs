/* Renders the README and docs/*.md as a small static site, for the Pages
   demo's /docs/. The markdown stays the source: GitHub shows the same files.

   The README is the home page and its Documentation table sets the sidebar
   order. Links between docs become links between pages; links to anything
   else in the repo (LICENSE, server/...) go to the file on GitHub.

     node scripts/build-docs.mjs dist/docs */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(process.cwd(), process.argv[2] || "dist/docs");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const REPO = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

// Sidebar order: the README's Documentation table.
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const pages = [...readme.matchAll(/^\| \[([^\]]+)\]\(docs\/([\w-]+)\.md\) \| (.+) \|$/gm)]
  .map(([, title, slug, blurb]) => ({ title, slug, blurb, src: `docs/${slug}.md` }));
const home = { title: "Overview", slug: "index", src: "README.md" };

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* A link as written in `src` (a repo-relative .md path), as it should be
   on the site. */
function siteHref(href, src) {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const target = normalize(join(dirname(src), path)).replace(/\\/g, "/");
  const anchor = hash ? `#${hash}` : "";
  if (target === "README.md") return `./${anchor}`;
  const page = pages.find((p) => p.src === target);
  if (page) return `${page.slug}.html${anchor}`;
  if (target.startsWith("docs/images/")) return target.slice("docs/".length);
  return `${REPO}/blob/main/${target}${anchor}`;
}

function render(page) {
  const md = readFileSync(join(ROOT, page.src), "utf8");
  const marked = new Marked(gfmHeadingId());
  let diagrams = false;
  marked.use({
    walkTokens(token) {
      if (token.type === "link" || token.type === "image") token.href = siteHref(token.href, page.src);
    },
    renderer: {
      // GitHub draws mermaid blocks; on the site Mermaid itself does.
      code({ text, lang }) {
        if (lang !== "mermaid") return false;
        diagrams = true;
        return `<pre class="mermaid">${escape(text)}</pre>\n`;
      }
    }
  });
  const html = marked.parse(md);
  const h1 = md.match(/^# (.+)$/m)?.[1] || page.title;
  return { html, h1, diagrams };
}

function nav(current) {
  const item = (p) => `<a href="${p.slug === "index" ? "./" : `${p.slug}.html`}"${p.slug === current.slug ? ' aria-current="page"' : ""}>${escape(p.title)}</a>`;
  return [item(home), ...pages.map(item)].join("\n        ");
}

const CSS = `
:root {
  --ember: #fe5e0e; --ember-ink: #c2410c; --sun-soft: #fff1d1;
  --ink: #000b1a; --ink-60: #5b6270; --line: rgba(0, 11, 26, 0.09);
  --card: rgba(255, 255, 255, 0.72);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; font: 17px/1.65 Urbanist, system-ui, sans-serif; color: var(--ink);
  background: linear-gradient(180deg, #f6f3ee 0%, #efe9df 100%) fixed;
}
a { color: var(--ember-ink); text-underline-offset: 2px; }
header {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 1.25rem;
  padding: 0.8rem 1.5rem; background: rgba(246, 243, 238, 0.86); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line);
}
header .brand { font-weight: 700; font-size: 1.15rem; color: var(--ink); text-decoration: none; display: flex; align-items: center; gap: 0.5rem; }
header .brand::before { content: ""; width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--ember); }
header .brand span { font-weight: 400; color: var(--ink-60); }
header nav { margin-left: auto; display: flex; gap: 0.5rem; }
header nav a {
  font-size: 0.9rem; font-weight: 600; text-decoration: none; color: var(--ink);
  padding: 0.4rem 0.9rem; border-radius: 999px; background: var(--card); border: 1px solid var(--line);
}
header nav a.primary { background: var(--ember); border-color: var(--ember); color: #fff; }
.layout { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 3rem; max-width: 72rem; margin: 0 auto; padding: 2rem 1.5rem 5rem; }
aside { position: sticky; top: 5rem; align-self: start; display: flex; flex-direction: column; gap: 0.1rem; }
aside a { color: var(--ink-60); text-decoration: none; padding: 0.35rem 0.75rem; border-radius: 10px; font-size: 0.95rem; }
aside a:hover { color: var(--ink); background: var(--card); }
aside a[aria-current] { color: var(--ink); background: var(--card); font-weight: 600; box-shadow: inset 3px 0 0 var(--ember); }
article { min-width: 0; max-width: 46rem; }
article h1 { font-size: 2.3rem; line-height: 1.15; margin: 0.5rem 0 1.25rem; letter-spacing: -0.01em; }
article h2 { font-size: 1.45rem; margin: 2.5rem 0 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--line); }
article h3 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; }
article h2, article h3 { scroll-margin-top: 5rem; }
article img { max-width: 100%; height: auto; border-radius: 14px; box-shadow: 0 18px 50px -24px rgba(0, 11, 26, 0.35); }
article code { font: 0.86em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(0, 11, 26, 0.06); padding: 0.1em 0.35em; border-radius: 5px; }
article pre { background: var(--ink); color: #f6f3ee; padding: 1rem 1.2rem; border-radius: 14px; overflow-x: auto; }
article pre code { background: none; padding: 0; color: inherit; font-size: 0.85rem; }
article table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; font-size: 0.93rem; }
article th, article td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
article th { font-weight: 600; }
article pre.mermaid { background: var(--card); color: var(--ink); border: 1px solid var(--line); text-align: center; }
article pre.mermaid:not([data-processed]) { color: transparent; }
article blockquote { margin: 1rem 0; padding: 0.6rem 1rem; background: var(--sun-soft); border-radius: 10px; }
article blockquote p { margin: 0; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: 0.9rem; color: var(--ink-60); }
@media (max-width: 800px) {
  body { font-size: 16px; }
  header { padding: 0.7rem 1rem; }
  header .brand span { display: none; }
  .layout { grid-template-columns: 1fr; gap: 1rem; padding: 1rem 1rem 4rem; }
  aside { position: static; flex-direction: row; flex-wrap: wrap; gap: 0.3rem; }
  aside a { background: var(--card); border: 1px solid var(--line); border-radius: 999px; font-size: 0.85rem; padding: 0.25rem 0.7rem; }
  article h1 { font-size: 1.8rem; }
}
`;

// Loaded only on pages with a diagram, in the docs' own colours.
const MERMAID = `
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({
      startOnLoad: true,
      theme: "base",
      fontFamily: "Urbanist, system-ui, sans-serif",
      themeVariables: {
        primaryColor: "#ffffff", primaryBorderColor: "#fe5e0e", primaryTextColor: "#000b1a",
        lineColor: "#5b6270", clusterBkg: "#fff1d1", clusterBorder: "#febe42",
        edgeLabelBackground: "#f6f3ee", fontSize: "15px"
      }
    });
  </script>`;

function page(p) {
  const { html, h1, diagrams } = render(p);
  const title = p.slug === "index" ? "Twinstage docs" : `${h1} · Twinstage docs`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(p.blurb || pkg.description)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="docs.css">
</head>
<body>
  <header>
    <a class="brand" href="./">Twinstage <span>docs</span></a>
    <nav>
      <a href="${REPO}">GitHub</a>
      <a class="primary" href="../">Try the demo</a>
    </nav>
  </header>
  <div class="layout">
    <aside>
        ${nav(p)}
    </aside>
    <article>
${html}
      <footer><a href="${REPO}/edit/main/${p.src}">Edit this page on GitHub</a></footer>
    </article>
  </div>${diagrams ? MERMAID : ""}
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "docs.css"), CSS.trimStart());
for (const p of [home, ...pages]) writeFileSync(join(OUT, `${p.slug}.html`), page(p));
if (existsSync(join(ROOT, "docs/images"))) cpSync(join(ROOT, "docs/images"), join(OUT, "images"), { recursive: true });
console.log(`docs: ${pages.length + 1} pages -> ${relative(process.cwd(), OUT) || "."}`);
