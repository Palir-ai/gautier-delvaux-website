/* Gautier Delvaux — API de l'espace d'administration (/admin/api/…) */
import {
  json, HttpError, db, getSetting, setSetting, safeEqual, sha256, hashPassword, checkPassword,
  sessionCookie, clearCookie, isAuthenticated, clientKey, tooManyAttempts, recordAttempt,
  readFile, commitFiles, parseCards, writeCards, parseArticlePage, buildArticlePage, updateSitemap,
  sanitizeBody, slugify, brusselsDay,
} from "../../../server/lib.js";

const SITE_JSON = "assets/data/site.json";
const MIN_PASSWORD = 12;

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Requête invalide.");
  }
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !isNaN(Date.parse(value));
}

/* ---------- Connexion ---------- */

async function session(env, request) {
  const auth = await getSetting(env, "auth");
  return json({ authenticated: await isAuthenticated(env, request), passwordSet: !!auth, email: env.ADMIN_EMAIL || "" });
}

async function setup(env, request) {
  const { token, password } = await body(request);
  const key = await clientKey(env, request);
  if (await tooManyAttempts(env, key)) throw new HttpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
  const used = await getSetting(env, "setup_used");
  const tokenHash = await sha256(String(token || ""));
  if (!env.SETUP_TOKEN || !token || !safeEqual(token, env.SETUP_TOKEN) || used === tokenHash) {
    await recordAttempt(env, key);
    throw new HttpError(403, "Ce lien de création de mot de passe n'est plus valable.");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
  }
  const version = crypto.randomUUID();
  await setSetting(env, "auth", { ...(await hashPassword(password)), version });
  await setSetting(env, "setup_used", tokenHash);
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, request, version) });
}

async function login(env, request) {
  const { email, password } = await body(request);
  const key = await clientKey(env, request);
  if (await tooManyAttempts(env, key)) throw new HttpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
  const auth = await getSetting(env, "auth");
  const emailOk = !!env.ADMIN_EMAIL && safeEqual(String(email || "").trim().toLowerCase(), env.ADMIN_EMAIL.trim().toLowerCase());
  const passwordOk = !!auth && typeof password === "string" && (await checkPassword(password, auth));
  if (!emailOk || !passwordOk) {
    await recordAttempt(env, key);
    throw new HttpError(401, "Adresse e-mail ou mot de passe incorrect.");
  }
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, request, auth.version) });
}

async function changePassword(env, request) {
  const { current, password } = await body(request);
  const auth = await getSetting(env, "auth");
  if (typeof current !== "string" || !(await checkPassword(current, auth))) {
    throw new HttpError(403, "Le mot de passe actuel est incorrect.");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
  }
  const version = crypto.randomUUID(); // déconnecte les autres appareils
  await setSetting(env, "auth", { ...(await hashPassword(password)), version });
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, request, version) });
}

/* ---------- Articles ---------- */

async function listArticles(env) {
  const articles = await readFile(env, "articles.html");
  if (articles === null) throw new HttpError(500, "articles.html est introuvable.");
  const drafts = await (await db(env)).prepare("SELECT id, data, updated FROM drafts ORDER BY updated DESC").all();
  return json({
    published: parseCards(articles),
    drafts: drafts.results.map((row) => {
      const data = JSON.parse(row.data);
      return { id: row.id, title: data.title || "Sans titre", updated: row.updated, slug: data.slug || null };
    }),
  });
}

async function getArticle(env, slug) {
  if (!/^article-[a-z0-9-]+$/.test(slug)) throw new HttpError(404, "Article introuvable.");
  const [page, articles] = await Promise.all([readFile(env, slug + ".html"), readFile(env, "articles.html")]);
  if (page === null) throw new HttpError(404, "Article introuvable.");
  const parsed = parseArticlePage(page);
  const card = parseCards(articles || "").find((c) => c.slug === slug);
  return json({
    slug,
    title: parsed.title,
    date: card ? card.date : parsed.date,
    summary: card ? card.summary : parsed.description,
    tags: card ? card.tags : [],
    body: parsed.body,
  });
}

async function readArticleInput(request) {
  const input = await body(request);
  const article = {
    slug: input.slug || null,
    title: cleanText(input.title, 160),
    date: input.date,
    summary: cleanText(input.summary, 320),
    tags: (Array.isArray(input.tags) ? input.tags : []).map((t) => cleanText(t, 40)).filter(Boolean).slice(0, 5),
    body: await sanitizeBody(String(input.body || "").slice(0, 400000)),
    draftId: input.draftId || null,
  };
  return article;
}

async function publish(env, request) {
  const article = await readArticleInput(request);
  if (!article.title) throw new HttpError(400, "Le titre est obligatoire.");
  if (!validDate(article.date)) throw new HttpError(400, "La date est invalide.");
  if (!article.summary) throw new HttpError(400, "Le résumé est obligatoire.");
  if (article.body.replace(/<[^>]+>/g, "").trim().length < 50) throw new HttpError(400, "Le texte de l'article est trop court.");

  const [articles, sitemap] = await Promise.all([readFile(env, "articles.html"), readFile(env, "sitemap.xml")]);
  if (articles === null) throw new HttpError(500, "articles.html est introuvable.");
  const cards = parseCards(articles);

  let isNew = !article.slug;
  if (isNew) {
    const base = "article-" + (slugify(article.title) || "sans-titre");
    let slug = base;
    for (let i = 2; (await readFile(env, slug + ".html")) !== null; i++) slug = `${base}-${i}`;
    article.slug = slug;
  } else {
    if (!/^article-[a-z0-9-]+$/.test(article.slug)) throw new HttpError(400, "Adresse d'article invalide.");
    const existing = await readFile(env, article.slug + ".html");
    isNew = existing === null; // article dépublié puis republié
    const card = cards.find((c) => c.slug === article.slug);
    // Le titre court de la carte est conservé tant que le titre de la page n'a pas changé.
    if (card && existing && parseArticlePage(existing).title === article.title) article.cardTitle = card.title;
  }

  const card = { slug: article.slug, title: article.cardTitle || article.title, summary: article.summary, tags: article.tags, date: article.date };
  const nextCards = [card, ...cards.filter((c) => c.slug !== article.slug)];
  const files = [
    { path: article.slug + ".html", content: buildArticlePage(articles, article) },
    { path: "articles.html", content: writeCards(articles, nextCards) },
  ];
  if (sitemap !== null) files.push({ path: "sitemap.xml", content: updateSitemap(sitemap, article.slug, true) });

  await commitFiles(env, `${isNew ? "Nouvel article" : "Article modifié"} : ${article.title}`, files);
  if (article.draftId) await (await db(env)).prepare("DELETE FROM drafts WHERE id = ?").bind(article.draftId).run();
  return json({ ok: true, slug: article.slug, created: isNew });
}

async function unpublish(env, slug) {
  if (!/^article-[a-z0-9-]+$/.test(slug)) throw new HttpError(404, "Article introuvable.");
  const [page, articles, sitemap] = await Promise.all([
    readFile(env, slug + ".html"), readFile(env, "articles.html"), readFile(env, "sitemap.xml"),
  ]);
  if (page === null || articles === null) throw new HttpError(404, "Article introuvable.");
  const cards = parseCards(articles);
  if (cards.length <= 1) throw new HttpError(400, "Le dernier article ne peut pas être retiré.");
  const parsed = parseArticlePage(page);
  const card = cards.find((c) => c.slug === slug);

  // L'article retiré est conservé comme brouillon : il peut être republié à tout moment.
  const draft = {
    slug, title: parsed.title, date: card ? card.date : parsed.date,
    summary: card ? card.summary : parsed.description, tags: card ? card.tags : [], body: parsed.body,
  };
  await (await db(env))
    .prepare("INSERT INTO drafts (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated")
    .bind(slug, JSON.stringify(draft), Date.now())
    .run();

  const files = [
    { path: slug + ".html", content: null },
    { path: "articles.html", content: writeCards(articles, cards.filter((c) => c.slug !== slug)) },
  ];
  if (sitemap !== null) files.push({ path: "sitemap.xml", content: updateSitemap(sitemap, slug, false) });
  await commitFiles(env, `Article retiré : ${parsed.title}`, files);
  return json({ ok: true, draftId: slug });
}

async function saveDraft(env, request) {
  const article = await readArticleInput(request);
  const id = article.draftId && /^[\w-]{1,80}$/.test(article.draftId) ? article.draftId : crypto.randomUUID();
  delete article.draftId;
  await (await db(env))
    .prepare("INSERT INTO drafts (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated")
    .bind(id, JSON.stringify(article), Date.now())
    .run();
  return json({ ok: true, draftId: id });
}

async function getDraft(env, id) {
  const row = await (await db(env)).prepare("SELECT data FROM drafts WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Brouillon introuvable.");
  return json({ ...JSON.parse(row.data), draftId: id });
}

async function deleteDraft(env, id) {
  await (await db(env)).prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/* ---------- Réglages du site (bandeau d'annonce, écoute des articles) ---------- */

const DEFAULT_SITE = { banner: { active: false, text: "", until: "" }, audio: false };

async function getSite(env) {
  const raw = await readFile(env, SITE_JSON);
  let site = DEFAULT_SITE;
  try {
    if (raw) site = { ...DEFAULT_SITE, ...JSON.parse(raw) };
  } catch { /* fichier illisible : valeurs par défaut */ }
  return json(site);
}

async function saveSite(env, request) {
  const input = await body(request);
  const banner = input.banner || {};
  const site = {
    banner: {
      active: !!banner.active,
      text: cleanText(banner.text, 240),
      until: validDate(banner.until) ? banner.until : "",
    },
    audio: !!input.audio,
  };
  if (site.banner.active && !site.banner.text) throw new HttpError(400, "Le texte de l'annonce est vide.");
  await commitFiles(env, "Réglages du site mis à jour depuis l'espace d'administration", [
    { path: SITE_JSON, content: JSON.stringify(site, null, 2) + "\n" },
  ]);
  return json({ ok: true, site });
}

/* ---------- Statistiques ---------- */

async function stats(env, url) {
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const d = await db(env);
  const today = new Date();
  const list = [];
  for (let i = days - 1; i >= 0; i--) list.push(brusselsDay(new Date(today.getTime() - i * 864e5)));
  const since = list[0];

  const [series, pages, refs, events] = await d.batch([
    d.prepare("SELECT day, kind, SUM(n) AS n FROM hits WHERE day >= ? AND kind IN ('view', 'visit') GROUP BY day, kind").bind(since),
    d.prepare("SELECT key, SUM(n) AS n FROM hits WHERE day >= ? AND kind = 'view' GROUP BY key ORDER BY n DESC LIMIT 15").bind(since),
    d.prepare("SELECT key, SUM(n) AS n FROM hits WHERE day >= ? AND kind = 'ref' GROUP BY key ORDER BY n DESC LIMIT 10").bind(since),
    d.prepare("SELECT key, SUM(n) AS n FROM hits WHERE day >= ? AND kind = 'event' GROUP BY key").bind(since),
  ]);

  const byDay = Object.fromEntries(list.map((day) => [day, { day, views: 0, visits: 0 }]));
  for (const row of series.results) {
    if (byDay[row.day]) byDay[row.day][row.kind === "view" ? "views" : "visits"] = row.n;
  }
  const first = await d.prepare("SELECT MIN(day) AS day FROM hits").first();
  return json({
    days,
    since: first && first.day ? first.day : null,
    series: Object.values(byDay),
    pages: pages.results,
    referrers: refs.results,
    events: Object.fromEntries(events.results.map((r) => [r.key, r.n])),
  });
}

/* ---------- Aiguillage ---------- */

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const path = (params.path || []).join("/");
  const method = request.method;
  const [head, id] = [params.path && params.path[0], params.path && params.path[1]];

  try {
    if (method !== "GET") {
      // Protection contre les requêtes déclenchées depuis un autre site.
      const origin = request.headers.get("Origin");
      if ((origin && origin !== url.origin) || request.headers.get("X-Requested-With") !== "admin") {
        throw new HttpError(403, "Requête refusée.");
      }
    }

    if (path === "session" && method === "GET") return await session(env, request);
    if (path === "setup" && method === "POST") return await setup(env, request);
    if (path === "login" && method === "POST") return await login(env, request);
    if (path === "logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });

    if (!(await isAuthenticated(env, request))) throw new HttpError(401, "Connexion requise.");

    if (path === "password" && method === "POST") return await changePassword(env, request);
    if (path === "articles" && method === "GET") return await listArticles(env);
    if (path === "articles" && method === "POST") return await publish(env, request);
    if (head === "articles" && id && method === "GET") return await getArticle(env, id);
    if (head === "articles" && id && method === "DELETE") return await unpublish(env, id);
    if (path === "drafts" && method === "POST") return await saveDraft(env, request);
    if (head === "drafts" && id && method === "GET") return await getDraft(env, id);
    if (head === "drafts" && id && method === "DELETE") return await deleteDraft(env, id);
    if (path === "site" && method === "GET") return await getSite(env);
    if (path === "site" && method === "POST") return await saveSite(env, request);
    if (path === "stats" && method === "GET") return await stats(env, url);

    throw new HttpError(404, "Introuvable.");
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Une erreur est survenue. Réessayez dans un instant." }, 500);
  }
}
