/* Gautier Delvaux — espace d'administration : fonctions partagées (Cloudflare Pages Functions)
 *
 * Réglages attendus dans Cloudflare (Settings → Variables and Secrets) :
 *   DB              base D1 (liaison)
 *   ADMIN_EMAIL     adresse e-mail de connexion
 *   SESSION_SECRET  secret long et aléatoire (signature des sessions)
 *   SETUP_TOKEN     jeton à usage unique pour créer / réinitialiser le mot de passe
 *   GITHUB_TOKEN    jeton GitHub (lecture/écriture du contenu du dépôt)
 *   GITHUB_REPO     ex. « Palir-ai/gautier-delvaux-website »
 *   GITHUB_BRANCH   facultatif, « main » par défaut
 */

export const SITE = "https://www.gautierdelvaux.be";
const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Base de données ---------- */

let schemaReady = false;

export async function db(env) {
  if (!env.DB) throw new HttpError(500, "La base de données n'est pas configurée.");
  if (!schemaReady) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)"),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS hits (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key))"
      ),
    ]);
    schemaReady = true;
  }
  return env.DB;
}

export async function getSetting(env, key) {
  const row = await (await db(env)).prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

export async function setSetting(env, key, value) {
  await (await db(env))
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}

/* ---------- Chiffrement, mots de passe, sessions ---------- */

function toB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function sha256(text) {
  return toB64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

const ITERATIONS = 100000; // maximum accepté par Cloudflare pour PBKDF2

export async function hashPassword(password, salt = toB64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations: ITERATIONS },
    key,
    256
  );
  return { salt, hash: toB64(bits) };
}

export async function checkPassword(password, auth) {
  const { hash } = await hashPassword(password, auth.salt);
  return safeEqual(hash, auth.hash);
}

async function hmac(env, text) {
  if (!env.SESSION_SECRET) throw new HttpError(500, "SESSION_SECRET n'est pas configuré.");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toB64(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

const COOKIE = "gd_admin";
const SESSION_DAYS = 30;

export async function sessionCookie(env, request, version) {
  const payload = toB64(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5, v: version })));
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${COOKIE}=${payload}.${await hmac(env, payload)}; Path=/admin; HttpOnly;${secure} SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function isAuthenticated(env, request) {
  const match = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!match) return false;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature || !safeEqual(signature, await hmac(env, payload))) return false;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromB64(payload)));
  } catch {
    return false;
  }
  if (!data || data.exp < Date.now()) return false;
  const auth = await getSetting(env, "auth");
  return !!auth && auth.version === data.v;
}

/* ---------- Limitation des tentatives de connexion ---------- */

const WINDOW = 15 * 60 * 1000;

export async function clientKey(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return (await sha256(ip + (env.SESSION_SECRET || ""))).slice(0, 22);
}

export async function tooManyAttempts(env, key) {
  const d = await db(env);
  const since = Date.now() - WINDOW;
  await d.prepare("DELETE FROM attempts WHERE ts < ?").bind(since).run();
  const mine = await d.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND ts >= ?").bind(key, since).first();
  const all = await d.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ts >= ?").bind(since).first();
  return mine.n >= 5 || all.n >= 40;
}

export async function recordAttempt(env, key) {
  await (await db(env)).prepare("INSERT INTO attempts (ip, ts) VALUES (?, ?)").bind(key, Date.now()).run();
}

/* ---------- GitHub : lecture et publication des fichiers du site ---------- */

async function gh(env, path, init = {}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new HttpError(500, "L'accès GitHub n'est pas configuré.");
  const base = env.GITHUB_API || "https://api.github.com";
  const res = await fetch(`${base}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gautier-delvaux-admin",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  return res;
}

async function ghJson(env, path, init) {
  const res = await gh(env, path, init);
  if (!res.ok) throw new HttpError(502, `GitHub a répondu ${res.status} (${path.split("?")[0]}).`);
  return res.json();
}

const branch = (env) => env.GITHUB_BRANCH || "main";

export async function readFile(env, path) {
  const res = await gh(env, `/contents/${encodeURI(path)}?ref=${branch(env)}`, {
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `GitHub a répondu ${res.status} (lecture de ${path}).`);
  return res.text();
}

/* Publie plusieurs fichiers en une seule modification. content === null supprime le fichier. */
export async function commitFiles(env, message, files) {
  const ref = await ghJson(env, `/git/ref/heads/${branch(env)}`);
  const parent = ref.object.sha;
  const parentCommit = await ghJson(env, `/git/commits/${parent}`);
  const tree = await ghJson(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({
      base_tree: parentCommit.tree.sha,
      tree: files.map((f) =>
        f.content === null
          ? { path: f.path, mode: "100644", type: "blob", sha: null }
          : { path: f.path, mode: "100644", type: "blob", content: f.content }
      ),
    }),
  });
  const commit = await ghJson(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
  });
  await ghJson(env, `/git/refs/heads/${branch(env)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  return commit.sha;
}

/* ---------- Articles : modèle de page, cartes, plan du site ---------- */

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function frenchDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d === 1 ? "1er" : d} ${MONTHS[m - 1]} ${y}`;
}

export function isoDate(french) {
  const m = String(french).toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-zéûô]+)\s+(\d{4})/);
  if (!m) return "1970-01-01";
  const month = MONTHS.indexOf(m[2]) + 1;
  return `${m[3]}-${String(month || 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function unesc(html) {
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function slugify(title) {
  return String(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

const CARD = /<article class="article-card[^"]*">[\s\S]*?<\/article>/g;

export function parseCards(articlesHtml) {
  return (articlesHtml.match(CARD) || []).map((html) => {
    const pick = (re) => (html.match(re) || [, ""])[1];
    const date = unesc(pick(/<div class="a-date">([\s\S]*?)<\/div>/));
    return {
      slug: pick(/class="article-link" href="([^"]+?)(?:\.html)?"/),
      title: unesc(pick(/class="article-link"[^>]*>([\s\S]*?)<\/a>/)),
      summary: unesc(pick(/<\/h3>\s*<p>([\s\S]*?)<\/p>/)),
      tags: [...html.matchAll(/<span class="tag">([\s\S]*?)<\/span>/g)].map((t) => unesc(t[1])),
      date: isoDate(date),
    };
  });
}

function cardHtml(card, featured) {
  const tags = card.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return (
    `<article class="article-card${featured ? " featured" : ""} reveal">\n` +
    `        <div class="a-date">${frenchDate(card.date)}</div>\n` +
    `        <h3><a class="article-link" href="${card.slug}.html">${esc(card.title)}</a></h3>\n` +
    `        <p>${esc(card.summary)}</p>\n` +
    `        <div class="tags">${tags}</div>\n` +
    `        <div class="card-actions"><span class="link-more" aria-hidden="true">Lire l'article</span></div>\n` +
    `      </article>`
  );
}

/* Réécrit la grille d'articles : du plus récent au plus ancien, le premier mis en avant. */
export function writeCards(articlesHtml, cards) {
  const first = articlesHtml.search(CARD);
  const all = articlesHtml.match(CARD) || [];
  if (first === -1) throw new HttpError(500, "La grille d'articles est introuvable dans articles.html.");
  const last = articlesHtml.lastIndexOf(all[all.length - 1]) + all[all.length - 1].length;
  const sorted = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (a.card.date < b.card.date ? 1 : a.card.date > b.card.date ? -1 : a.index - b.index))
    .map((x) => x.card);
  const grid = sorted.map((card, i) => cardHtml(card, i === 0)).join("\n      ");
  return articlesHtml.slice(0, first) + grid + articlesHtml.slice(last);
}

export function parseArticlePage(html) {
  const pick = (re) => (html.match(re) || [, ""])[1];
  const start = html.search(/<div[^>]*class="[^"]*\barticle-body\b[^"]*"[^>]*>/);
  let body = "";
  if (start !== -1) {
    body = html.slice(html.indexOf(">", start) + 1);
    const end = body.search(/<hr[^>]*class="[^"]*\bhairline\b/);
    if (end !== -1) body = body.slice(0, end);
  }
  return {
    title: unesc(pick(/<h1[^>]*>([\s\S]*?)<\/h1>/)),
    date: isoDate(pick(/<span class="eyebrow">([\s\S]*?)<\/span>/)),
    description: unesc(pick(/<meta name="description" content="([^"]*)"/)),
    body: body.trim(),
  };
}

/* Construit la page d'un article à partir de l'habillage (en-tête, pied de page) d'articles.html. */
export function buildArticlePage(skeleton, article) {
  const mainStart = skeleton.indexOf("<main>");
  const mainEnd = skeleton.indexOf("</main>");
  if (mainStart === -1 || mainEnd === -1) throw new HttpError(500, "Le modèle de page est introuvable.");
  const title = `${esc(article.title)} — Gautier Delvaux, psychologue clinicien`;
  const description = esc(article.summary);
  const url = `${SITE}/${article.slug}`;
  const set = (html, re, value) => html.replace(re, (_, before, after) => before + value + after);

  let head = skeleton.slice(0, mainStart);
  head = set(head, /(<title>)[\s\S]*?(<\/title>)/, title);
  head = set(head, /(<meta name="description" content=")[^"]*(")/, description);
  head = set(head, /(<link rel="canonical" href=")[^"]*(")/, url);
  head = set(head, /(<meta property="og:type" content=")[^"]*(")/, "article");
  head = set(head, /(<meta property="og:title" content=")[^"]*(")/, title);
  head = set(head, /(<meta property="og:description" content=")[^"]*(")/, description);
  head = set(head, /(<meta property="og:url" content=")[^"]*(")/, url);

  const main =
    `<main>\n<section class="page-hero">\n  <div class="container-narrow">\n` +
    `    <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="index.html">Accueil</a><span class="sep">·</span><a href="articles.html">Articles</a><span class="sep">·</span>Article</nav>\n` +
    `    <span class="eyebrow">Article — ${frenchDate(article.date)}</span>\n` +
    `    <h1>${esc(article.title)}</h1>\n` +
    `  </div>\n</section>\n\n<section class="section">\n  <div class="container-narrow prose article-body">\n` +
    `${article.body}\n` +
    `    <hr class="hairline"/>\n` +
    `    <p><a class="link-more" href="articles.html">← Tous les articles</a></p>\n` +
    `  </div>\n</section>\n\n`;
  return head + main + skeleton.slice(mainEnd);
}

export function updateSitemap(xml, slug, present) {
  const line = `  <url><loc>${SITE}/${slug}</loc></url>\n`;
  let out = xml.split(line).join("");
  if (present) out = out.replace("</urlset>", line + "</urlset>");
  return out;
}

/* ---------- Nettoyage du texte saisi dans l'éditeur ---------- */

const ALLOWED = new Set(["p", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "blockquote", "br", "sup", "sub"]);
const DROPPED = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "textarea", "select",
  "noscript", "template", "img", "picture", "video", "audio", "link", "meta", "head", "title", "base",
]);
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#|[a-z0-9-]+(\.html)?(#[\w-]*)?$)/i;

export async function sanitizeBody(html) {
  const rewriter = new HTMLRewriter().on("*", {
    element(el) {
      const tag = el.tagName.toLowerCase();
      if (DROPPED.has(tag)) return void el.remove();
      if (tag === "div") el.tagName = "p";
      else if (tag === "h1") el.tagName = "h2";
      else if (!ALLOWED.has(tag)) return void el.removeAndKeepContent();
      const href = tag === "a" ? (el.getAttribute("href") || "").trim() : null;
      for (const [name] of [...el.attributes]) el.removeAttribute(name);
      if (tag === "a") {
        if (!SAFE_LINK.test(href)) return void el.removeAndKeepContent();
        el.setAttribute("href", href);
        if (/^https?:/i.test(href)) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener");
        }
      }
    },
    comments(comment) {
      comment.remove();
    },
  }).onDocument({
    comments(comment) {
      comment.remove();
    },
  });
  const clean = await rewriter.transform(new Response(String(html))).text();
  return clean
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- Statistiques ---------- */

export function brusselsDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(date);
}
