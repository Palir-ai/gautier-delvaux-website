/* Gautier Delvaux — compteur de visites (POST /api/hit)
 *
 * Compteur maison, sans cookie et sans donnée personnelle : seuls des totaux
 * par jour sont enregistrés (pages vues, visites, site d'origine, clics sur
 * les boutons de contact). Aucune adresse IP ni identifiant n'est conservé.
 */
import { db, brusselsDay } from "../../server/lib.js";

const BOTS = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|curl|wget|python|scrapy/i;
const EVENTS = new Set(["rdv", "whatsapp", "email", "phone"]);

function cleanPath(value) {
  let path = String(value || "/").split("?")[0].split("#")[0].slice(0, 120);
  if (!path.startsWith("/")) path = "/" + path;
  path = path.replace(/\.html$/, "").replace(/\/index$/, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return /^\/[\w\-./]*$/.test(path) ? path : null;
}

function cleanHost(value) {
  const host = String(value || "").toLowerCase().replace(/^www\./, "").slice(0, 80);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204 });
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return done;
    if (BOTS.test(request.headers.get("User-Agent") || "")) return done;

    const data = JSON.parse((await request.text()).slice(0, 1000));
    const d = await db(env);
    const day = brusselsDay();
    const add = (kind, key) =>
      d.prepare("INSERT INTO hits (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1").bind(day, kind, key);

    const writes = [];
    if (data.e) {
      if (EVENTS.has(data.e)) writes.push(add("event", data.e));
    } else {
      const path = cleanPath(data.p);
      if (!path || path.startsWith("/admin")) return done;
      writes.push(add("view", path));
      if (data.v) {
        writes.push(add("visit", "all"));
        const host = cleanHost(data.r);
        writes.push(add("ref", host && host !== url.hostname.replace(/^www\./, "") ? host : "direct"));
      }
    }
    if (writes.length) await d.batch(writes);
  } catch (err) {
    console.error(err);
  }
  return done;
}
