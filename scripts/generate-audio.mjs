#!/usr/bin/env node
/* Gautier Delvaux — narration audio des articles
 *
 * Pour chaque article-*.html : extrait le titre et le corps de l'article,
 * et génère un MP3 dans assets/audio/ si le texte est nouveau ou a changé.
 * La voix est produite par Piper, un moteur libre et gratuit qui tourne sur
 * la machine (aucun service payant). Le fichier assets/audio/manifest.json
 * liste les audios disponibles ; le site n'affiche le bouton « Écouter »
 * que pour ceux-ci.
 *
 * Préparation (une fois) : bash scripts/setup-voice.sh
 *
 * Usage :
 *   node scripts/generate-audio.mjs              génère ce qui manque / a changé
 *   node scripts/generate-audio.mjs --dry-run    montre ce qui serait généré
 *   node scripts/generate-audio.mjs --text slug  affiche le texte lu pour un article
 *   node scripts/generate-audio.mjs --only slug  ne traite qu'un article
 *   node scripts/generate-audio.mjs --check      vérifie que la voix fonctionne
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, mkdtempSync, rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_DIR = join(ROOT, "assets", "audio");
const MANIFEST = join(AUDIO_DIR, "manifest.json");

const VOICE = "fr_FR-tom-medium";
const VOICE_FILE = join(ROOT, ".cache", "voices", VOICE + ".onnx");
const PYTHON = join(ROOT, ".cache", "venv", "bin", "python");
const SENTENCE_SILENCE = "0.35"; // pause entre les phrases, en secondes
const BITRATE_KBPS = 64;
const ENGINE = ["piper", VOICE, SENTENCE_SILENCE, BITRATE_KBPS].join(":");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const ONLY = argValue("--only");
const SHOW_TEXT = argValue("--text");
const CHECK = args.includes("--check");

/* ---------- Extraction du texte ---------- */

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  hellip: "…", mdash: "—", ndash: "–", eacute: "é", egrave: "è", ecirc: "ê",
  agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù",
  icirc: "î", iuml: "ï", euml: "ë", oelig: "œ", euro: "€", deg: "°", middot: "·",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

function inlineText(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Termine un bloc par une ponctuation, pour que la voix marque une pause. */
function sentence(s) {
  if (!s) return "";
  return /[.!?…:;]$/.test(s) ? s : s + ".";
}

const REFERENCES = /^(r[ée]f[ée]rences?|sources?|bibliographie)( bibliographiques?)?\s*:?$/i;

export function extractArticle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? inlineText(h1[1]) : "";

  const start = html.search(/<div[^>]*class="[^"]*\barticle-body\b[^"]*"[^>]*>/i);
  if (start === -1) return null;
  let body = html.slice(html.indexOf(">", start) + 1);
  // Le corps s'arrête au filet qui précède « ← Tous les articles ».
  const end = body.search(/<hr[^>]*class="[^"]*\bhairline\b|<\/section>/i);
  if (end !== -1) body = body.slice(0, end);

  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|figure|table|iframe|svg|sup)\b[\s\S]*?<\/\1>/gi, "")
    // Éléments marqués comme non lus (ex. bibliographie).
    .replace(/<([a-z0-9]+)\b[^>]*data-audio-skip[^>]*>[\s\S]*?<\/\1>/gi, "");

  const blocks = [];
  const re = /<(p|h[2-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    const text = inlineText(m[2]);
    // La bibliographie de fin d'article n'est pas lue.
    if (REFERENCES.test(text)) break;
    if (text && text !== title) blocks.push(sentence(text));
  }
  if (!title || !blocks.length) return null;
  return { title, blocks: [sentence(title), ...blocks] };
}

/* ---------- Synthèse vocale (Piper, gratuit et local) ---------- */

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`${cmd} : ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} a échoué : ${(res.stderr || "").trim().slice(-400)}`);
}

function engineReady() {
  return existsSync(PYTHON) && existsSync(VOICE_FILE);
}

/* Lit les blocs de texte (un par ligne) et renvoie le MP3. */
function synthesize(blocks) {
  const work = mkdtempSync(join(tmpdir(), "article-audio-"));
  try {
    const txt = join(work, "texte.txt");
    const wav = join(work, "voix.wav");
    const mp3 = join(work, "voix.mp3");
    writeFileSync(txt, blocks.join("\n") + "\n");
    run(PYTHON, ["-m", "piper", "-m", VOICE_FILE, "-i", txt, "-f", wav, "--sentence-silence", SENTENCE_SILENCE]);
    run("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", BITRATE_KBPS + "k", mp3]);
    const audio = readFileSync(mp3);
    if (audio.length < 10000) throw new Error("audio vide");
    return audio;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* ---------- Programme principal ---------- */

function loadManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}

async function main() {
  if (CHECK) {
    if (!engineReady()) throw new Error("Voix non installée : lancez d'abord bash scripts/setup-voice.sh");
    const audio = synthesize(["Bonjour, la voix fonctionne correctement."]);
    console.log(`Voix opérationnelle (${audio.length} octets).`);
    return;
  }
  const ready = engineReady();
  const files = readdirSync(ROOT).filter((f) => /^article-.+\.html$/.test(f)).sort();
  const manifest = loadManifest();
  const next = {};
  let generated = 0;
  let pending = 0;
  let failed = 0;

  for (const file of files) {
    const slug = file.replace(/\.html$/, "");
    const article = extractArticle(readFileSync(join(ROOT, file), "utf8"));
    if (!article) { console.log(`– ${slug} : pas de corps d'article, ignoré`); continue; }

    const text = article.blocks.join("\n\n");
    if (SHOW_TEXT) {
      if (SHOW_TEXT === slug) console.log(text);
      continue;
    }
    const hash = createHash("sha256").update([ENGINE, text].join("\n")).digest("hex").slice(0, 16);
    const mp3 = join(AUDIO_DIR, slug + ".mp3");
    const known = manifest[slug];

    if (known && known.hash === hash && existsSync(mp3)) {
      next[slug] = known;
      continue;
    }
    // Tant que le nouvel audio n'existe pas, on garde l'ancien (s'il y en a un).
    if (known && existsSync(mp3)) next[slug] = known;

    if (ONLY && ONLY !== slug) continue;
    pending++;
    console.log(`→ ${slug} : ${text.length} caractères`);
    if (DRY || !ready) continue;

    try {
      const audio = synthesize(article.blocks);
      mkdirSync(AUDIO_DIR, { recursive: true });
      writeFileSync(mp3, audio);
      next[slug] = {
        src: `assets/audio/${slug}.mp3?v=${hash.slice(0, 8)}`,
        title: article.title,
        duration: Math.round((audio.length * 8) / (BITRATE_KBPS * 1000)),
        hash,
      };
      generated++;
      console.log(`  ✓ ${slug}.mp3 (${(audio.length / 1e6).toFixed(1)} Mo)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${slug} : ${err.message}`);
    }
  }

  if (SHOW_TEXT) return;

  if (!DRY) {
    // Supprime les audios d'articles qui n'existent plus.
    if (existsSync(AUDIO_DIR)) {
      for (const f of readdirSync(AUDIO_DIR)) {
        if (f.endsWith(".mp3") && !files.includes(f.replace(/\.mp3$/, ".html"))) {
          unlinkSync(join(AUDIO_DIR, f));
          console.log(`– ${f} supprimé (article retiré)`);
        }
      }
    }
    mkdirSync(AUDIO_DIR, { recursive: true });
    const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
    writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
  }

  if (pending && !ready && !DRY) {
    console.log(`\nVoix non installée (bash scripts/setup-voice.sh) : ${pending} article(s) en attente d'audio.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${generated} audio(s) généré(s), ${pending - generated - failed} en attente, ${failed} échec(s).`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
