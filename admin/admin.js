/* Gautier Delvaux — espace d'administration */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var state = { email: "", tab: "articles" };
  var toastTimer = null;

  /* ---------- Outils ---------- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function toast(message, bad) {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, bad ? 6000 : 4000);
  }

  function api(path, method, data) {
    return fetch("/admin/api/" + path, {
      method: method || "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "admin" },
      body: data ? JSON.stringify(data) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) return body;
        if (res.status === 401 && path !== "login") { showLogin(); }
        var err = new Error(body.error || "Une erreur est survenue.");
        err.status = res.status;
        throw err;
      });
    });
  }

  function busy(button, on, label) {
    if (!button) return;
    if (on) { button.dataset.label = button.textContent; button.textContent = label || "Un instant…"; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }

  var MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function frDate(iso) {
    var p = String(iso).split("-");
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] + " " + p[0];
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var modal = document.createElement("div");
      modal.className = "modal";
      modal.innerHTML =
        '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        "<h2>" + esc(title) + "</h2><p>" + esc(text) + "</p>" +
        '<div class="row end"><button class="btn ghost" data-no>Annuler</button>' +
        '<button class="btn' + (danger ? " danger" : "") + '" data-yes>' + esc(okLabel) + "</button></div></div>";
      function close(value) { modal.remove(); document.removeEventListener("keydown", onKey); resolve(value); }
      function onKey(e) { if (e.key === "Escape") close(false); }
      $("[data-no]", modal).addEventListener("click", function () { close(false); });
      $("[data-yes]", modal).addEventListener("click", function () { close(true); });
      modal.addEventListener("click", function (e) { if (e.target === modal) close(false); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(modal);
      $("[data-yes]", modal).focus();
    });
  }

  /* ---------- Connexion et création du mot de passe ---------- */

  function authCard(inner) {
    app.innerHTML =
      '<div class="auth"><div class="auth-card">' +
      '<img src="/assets/img/logo.png" alt="Gautier Delvaux"/>' + inner + "</div></div>";
  }

  function showLogin() {
    authCard(
      "<h1>Administration</h1>" +
      '<p class="intro">Connectez-vous pour gérer votre site.</p>' +
      '<form id="login-form" novalidate>' +
      '<p class="error" role="alert" hidden></p>' +
      '<label class="field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required value="' + esc(state.email) + '"/></label>' +
      '<label class="field"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" required/></label>' +
      '<button class="btn" type="submit">Se connecter</button></form>'
    );
    var form = $("#login-form");
    (form.email.value ? form.password : form.email).focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var button = $("button", form);
      var error = $(".error", form);
      error.hidden = true;
      busy(button, true);
      api("login", "POST", { email: form.email.value, password: form.password.value })
        .then(function () { enter(); })
        .catch(function (err) { error.textContent = err.message; error.hidden = false; busy(button, false); form.password.value = ""; form.password.focus(); });
    });
  }

  function showSetup(token) {
    authCard(
      "<h1>Votre mot de passe</h1>" +
      '<p class="intro">Choisissez le mot de passe de votre espace d\'administration.</p>' +
      '<form id="setup-form" novalidate>' +
      '<p class="error" role="alert" hidden></p>' +
      '<input type="email" name="email" autocomplete="username" value="' + esc(state.email) + '" hidden/>' +
      '<label class="field"><span>Nouveau mot de passe</span><input type="password" name="password" autocomplete="new-password" minlength="12" required/>' +
      "<small>Au moins 12 caractères. Une phrase de quatre mots sans rapport entre eux, avec un nombre, est facile à retenir et difficile à deviner.</small></label>" +
      '<label class="field"><span>Confirmez le mot de passe</span><input type="password" name="confirm" autocomplete="new-password" required/></label>' +
      '<button class="btn" type="submit">Enregistrer</button></form>'
    );
    var form = $("#setup-form");
    form.password.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var error = $(".error", form);
      var button = $("button", form);
      error.hidden = true;
      if (form.password.value.length < 12) { error.textContent = "Le mot de passe doit contenir au moins 12 caractères."; error.hidden = false; return; }
      if (form.password.value !== form.confirm.value) { error.textContent = "Les deux mots de passe ne sont pas identiques."; error.hidden = false; return; }
      busy(button, true);
      api("setup", "POST", { token: token, password: form.password.value })
        .then(function () { history.replaceState(null, "", "/admin/"); enter(); toast("Mot de passe enregistré."); })
        .catch(function (err) { error.textContent = err.message; error.hidden = false; busy(button, false); });
    });
  }

  /* ---------- Structure une fois connecté ---------- */

  var TABS = [["articles", "Articles"], ["stats", "Statistiques"], ["site", "Annonce & réglages"], ["account", "Mon compte"]];

  function enter() {
    // Les visites de l'administrateur ne sont pas comptées dans les statistiques.
    try { window.localStorage.setItem("gd_no_stats", "1"); } catch (e) { /* stockage indisponible */ }
    app.innerHTML =
      '<header class="topbar"><div class="topbar-inner">' +
      '<span class="brand">Gautier Delvaux</span>' +
      '<nav class="tabs" aria-label="Sections">' +
      TABS.map(function (t) { return '<button type="button" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") +
      '</nav><a class="site-link" href="/" target="_blank" rel="noopener">Voir le site ↗</a>' +
      '</div></header><main class="main" id="view"></main>';
    $all(".tabs button").forEach(function (button) {
      button.addEventListener("click", function () { go(button.dataset.tab); });
    });
    // Accès direct à une section : /admin/#stats, /admin/#site, /admin/#account, /admin/#new
    var wanted = location.hash.slice(1);
    if (wanted === "new") return go("edit", {});
    if (TABS.some(function (t) { return t[0] === wanted; })) state.tab = wanted;
    go(state.tab);
  }

  function go(tab, arg) {
    if (state.dirty && !window.confirm("Les modifications non enregistrées seront perdues. Continuer ?")) return;
    state.dirty = false;
    state.tab = tab === "edit" ? "articles" : tab;
    $all(".tabs button").forEach(function (button) {
      if (button.dataset.tab === state.tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    var view = $("#view");
    view.innerHTML = '<p class="loading">Chargement…</p>';
    window.scrollTo(0, 0);
    ({ articles: viewArticles, edit: viewEditor, stats: viewStats, site: viewSite, account: viewAccount })[tab](view, arg);
  }

  function fail(view) {
    return function (err) {
      if (err.status === 401) return;
      view.innerHTML = '<div class="card"><p class="error" role="alert">' + esc(err.message) + '</p><button class="btn ghost" id="retry">Réessayer</button></div>';
      $("#retry").addEventListener("click", function () { go(state.tab); });
    };
  }

  /* ---------- Articles ---------- */

  function viewArticles(view) {
    api("articles").then(function (data) {
      var drafts = data.drafts.map(function (d) {
        return '<li><div class="grow"><span class="title">' + esc(d.title) + '</span><span class="meta">Brouillon — modifié le ' +
          esc(new Date(d.updated).toLocaleDateString("fr-BE")) + '</span></div><div class="actions">' +
          '<button class="btn ghost sm" data-draft="' + esc(d.id) + '">Modifier</button>' +
          '<button class="btn danger sm" data-delete-draft="' + esc(d.id) + '">Supprimer</button></div></li>';
      }).join("");
      var published = data.published.map(function (a) {
        return '<li><div class="grow"><span class="title">' + esc(a.title) + '</span><span class="meta">' + esc(frDate(a.date)) +
          (a.tags.length ? " · " + esc(a.tags.join(", ")) : "") + '</span></div><div class="actions">' +
          '<a class="btn ghost sm" href="/' + esc(a.slug) + '" target="_blank" rel="noopener">Voir</a>' +
          '<button class="btn ghost sm" data-edit="' + esc(a.slug) + '">Modifier</button>' +
          '<button class="btn danger sm" data-unpublish="' + esc(a.slug) + '" data-title="' + esc(a.title) + '">Retirer</button></div></li>';
      }).join("");
      view.innerHTML =
        '<div class="page-head"><div><h1>Articles</h1><p>Rédigez, modifiez ou retirez les articles de votre site.</p></div>' +
        '<button class="btn" id="new-article">Nouvel article</button></div>' +
        (drafts ? '<section class="card"><h2>Brouillons</h2><p>Visibles de vous seul, pas encore en ligne.</p><ul class="list">' + drafts + "</ul></section>" : "") +
        '<section class="card"><h2>En ligne</h2><p>' + data.published.length + " article" + (data.published.length > 1 ? "s" : "") + ' sur le site.</p>' +
        (published ? '<ul class="list">' + published + "</ul>" : '<p class="empty">Aucun article pour le moment.</p>') + "</section>";

      $("#new-article").addEventListener("click", function () { go("edit", {}); });
      $all("[data-edit]", view).forEach(function (b) { b.addEventListener("click", function () { go("edit", { slug: b.dataset.edit }); }); });
      $all("[data-draft]", view).forEach(function (b) { b.addEventListener("click", function () { go("edit", { draftId: b.dataset.draft }); }); });
      $all("[data-delete-draft]", view).forEach(function (b) {
        b.addEventListener("click", function () {
          confirmBox("Supprimer ce brouillon ?", "Cette action est définitive.", "Supprimer", true).then(function (yes) {
            if (!yes) return;
            api("drafts/" + encodeURIComponent(b.dataset.deleteDraft), "DELETE").then(function () { toast("Brouillon supprimé."); go("articles"); })
              .catch(function (err) { toast(err.message, true); });
          });
        });
      });
      $all("[data-unpublish]", view).forEach(function (b) {
        b.addEventListener("click", function () {
          confirmBox("Retirer cet article du site ?", "« " + b.dataset.title + " » ne sera plus visible. Il sera conservé dans vos brouillons et pourra être republié.", "Retirer", true)
            .then(function (yes) {
              if (!yes) return;
              busy(b, true);
              api("articles/" + encodeURIComponent(b.dataset.unpublish), "DELETE")
                .then(function () { toast("Article retiré. Il disparaîtra du site dans environ une minute."); go("articles"); })
                .catch(function (err) { toast(err.message, true); busy(b, false); });
            });
        });
      });
    }).catch(fail(view));
  }

  /* ---------- Éditeur d'article ---------- */

  var ALLOWED = { P: 1, H2: 1, H3: 1, H4: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, UL: 1, OL: 1, LI: 1, A: 1, BLOCKQUOTE: 1, BR: 1, SUP: 1, SUB: 1 };
  var DROPPED = { SCRIPT: 1, STYLE: 1, IFRAME: 1, IMG: 1, SVG: 1, META: 1, LINK: 1, TITLE: 1, OBJECT: 1, VIDEO: 1, AUDIO: 1, FORM: 1, INPUT: 1, BUTTON: 1 };

  /* Nettoie un texte collé (Word, page web…) pour ne garder que la mise en forme utile. */
  function cleanHtml(html) {
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 8) { child.remove(); return; }
        if (child.nodeType !== 1) return;
        var tag = child.tagName;
        if (DROPPED[tag]) { child.remove(); return; }
        walk(child);
        if (tag === "H1") tag = "H2";
        if (tag === "DIV") tag = "P";
        if (!ALLOWED[tag]) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        var clean = doc.createElement(tag);
        if (tag === "A") {
          var href = child.getAttribute("href") || "";
          if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) clean.setAttribute("href", href);
        }
        while (child.firstChild) clean.appendChild(child.firstChild);
        node.replaceChild(clean, child);
      });
    })(doc.body.firstChild);
    return doc.body.firstChild.innerHTML;
  }

  function viewEditor(view, arg) {
    var load = arg.slug ? api("articles/" + encodeURIComponent(arg.slug))
      : arg.draftId ? api("drafts/" + encodeURIComponent(arg.draftId))
      : Promise.resolve({ title: "", date: todayIso(), summary: "", tags: [], body: "" });

    load.then(function (article) {
      var slug = article.slug || null;
      var draftId = article.draftId || null;
      var online = !!arg.slug;
      view.innerHTML =
        '<div class="page-head"><div><h1>' + (online ? "Modifier l'article" : "Nouvel article") + "</h1>" +
        "<p>" + (online ? "Cet article est en ligne. Vos changements seront visibles après « Publier »." : "Rien n'est visible sur le site tant que vous n'avez pas publié.") + "</p></div>" +
        '<button class="btn ghost" id="back">← Tous les articles</button></div>' +
        '<form id="article-form" novalidate>' +
        '<label class="field"><span>Titre</span><input type="text" name="title" maxlength="160" required value="' + esc(article.title) + '"/></label>' +
        '<div class="grid-2">' +
        '<label class="field"><span>Date</span><input type="date" name="date" required value="' + esc(article.date) + '"/></label>' +
        '<label class="field"><span>Mots-clés</span><input type="text" name="tags" value="' + esc((article.tags || []).join(", ")) + '" placeholder="EMDR, Traumatismes"/>' +
        "<small>Séparés par des virgules, cinq au maximum.</small></label></div>" +
        '<label class="field"><span>Résumé <em class="counter" id="summary-count"></em></span>' +
        '<textarea name="summary" maxlength="320" rows="3" required>' + esc(article.summary) + "</textarea>" +
        "<small>Deux phrases. Ce texte apparaît sur la page Articles et dans les résultats Google (idéalement moins de 160 caractères).</small></label>" +
        '<span class="label">Texte de l\'article</span>' +
        '<div class="toolbar" role="toolbar" aria-label="Mise en forme">' +
        '<button type="button" data-block="h2" title="Titre de section">Titre</button>' +
        '<button type="button" data-block="h3" title="Sous-titre">Sous-titre</button>' +
        '<button type="button" data-block="p" title="Texte normal">Texte</button>' +
        '<span class="sep"></span>' +
        '<button type="button" data-cmd="bold" title="Gras"><strong>G</strong></button>' +
        '<button type="button" data-cmd="italic" title="Italique"><em>I</em></button>' +
        '<span class="sep"></span>' +
        '<button type="button" data-cmd="insertUnorderedList" title="Liste à puces">• Liste</button>' +
        '<button type="button" data-cmd="insertOrderedList" title="Liste numérotée">1. Liste</button>' +
        '<button type="button" data-block="blockquote" title="Citation">« Citation »</button>' +
        '<span class="sep"></span>' +
        '<button type="button" data-link title="Ajouter un lien">Lien</button>' +
        '<button type="button" data-cmd="unlink" title="Retirer le lien">Retirer le lien</button>' +
        '<button type="button" data-cmd="removeFormat" title="Effacer la mise en forme">Effacer</button>' +
        "</div>" +
        '<div class="editor" id="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Texte de l\'article" data-placeholder="Écrivez ou collez votre texte ici…"></div>' +
        '<div class="editor-actions"><span class="status" id="status"></span>' +
        '<button type="button" class="btn ghost" id="preview">Aperçu</button>' +
        '<button type="button" class="btn ghost" id="save-draft">Enregistrer le brouillon</button>' +
        '<button type="submit" class="btn" id="publish">Publier</button></div></form>';

      var form = $("#article-form");
      var editor = $("#editor");
      var status = $("#status");
      editor.innerHTML = article.body || "";
      try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* non pris en charge */ }

      function touch() { state.dirty = true; status.textContent = "Modifications non enregistrées"; }
      function count() { $("#summary-count").textContent = form.summary.value.length + " / 160 conseillés"; }
      count();
      form.addEventListener("input", function () { touch(); count(); });
      editor.addEventListener("input", touch);

      $all(".toolbar button", view).forEach(function (button) {
        button.addEventListener("mousedown", function (e) { e.preventDefault(); }); // garde la sélection
        button.addEventListener("click", function () {
          editor.focus();
          if (button.dataset.block) document.execCommand("formatBlock", false, button.dataset.block);
          else if (button.dataset.cmd) document.execCommand(button.dataset.cmd, false, null);
          else if (button.hasAttribute("data-link")) {
            var url = window.prompt("Adresse du lien (https://…)", "https://");
            if (url && /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url.trim())) document.execCommand("createLink", false, url.trim());
            else if (url) toast("Cette adresse n'est pas valide.", true);
          }
          touch();
        });
      });

      editor.addEventListener("paste", function (e) {
        var clip = e.clipboardData;
        if (!clip) return;
        e.preventDefault();
        var html = clip.getData("text/html");
        var out;
        if (html) out = cleanHtml(html);
        else {
          out = clip.getData("text/plain").split(/\n\s*\n|\r\n\s*\r\n/).map(function (p) {
            return p.trim() ? "<p>" + esc(p.trim()).replace(/\r?\n/g, "<br>") + "</p>" : "";
          }).join("");
        }
        document.execCommand("insertHTML", false, out);
        touch();
      });

      function collect() {
        return {
          slug: slug,
          draftId: draftId,
          title: form.title.value.trim(),
          date: form.date.value,
          summary: form.summary.value.trim(),
          tags: form.tags.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 5),
          body: editor.innerHTML,
        };
      }

      $("#back").addEventListener("click", function () { go("articles"); });

      $("#save-draft").addEventListener("click", function () {
        var button = this;
        busy(button, true, "Enregistrement…");
        api("drafts", "POST", collect()).then(function (res) {
          draftId = res.draftId;
          state.dirty = false;
          status.textContent = "Brouillon enregistré à " + new Date().toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });
          toast("Brouillon enregistré.");
        }).catch(function (err) { toast(err.message, true); }).then(function () { busy(button, false); });
      });

      $("#preview").addEventListener("click", function () {
        var data = collect();
        var modal = document.createElement("div");
        modal.className = "modal";
        modal.innerHTML = '<div class="modal-box wide" role="dialog" aria-modal="true" aria-label="Aperçu de l\'article">' +
          '<header><strong>Aperçu</strong><button class="btn ghost sm" data-close>Fermer</button></header><iframe title="Aperçu de l\'article"></iframe></div>';
        document.body.appendChild(modal);
        $("iframe", modal).srcdoc =
          '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<base target="_blank"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet">' +
          '<link rel="stylesheet" href="/assets/css/style.css"></head><body><main><section class="page-hero"><div class="container-narrow">' +
          '<span class="eyebrow">Article — ' + esc(data.date ? frDate(data.date) : "") + "</span><h1>" + esc(data.title || "Sans titre") + "</h1></div></section>" +
          '<section class="section"><div class="container-narrow prose article-body">' + cleanHtml(data.body) + "</div></section></main></body></html>";
        function close() { modal.remove(); document.removeEventListener("keydown", onKey); }
        function onKey(e) { if (e.key === "Escape") close(); }
        $("[data-close]", modal).addEventListener("click", close);
        modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
        document.addEventListener("keydown", onKey);
        $("[data-close]", modal).focus();
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var data = collect();
        if (!data.title) { toast("Ajoutez un titre.", true); form.title.focus(); return; }
        if (!data.date) { toast("Indiquez une date.", true); form.date.focus(); return; }
        if (!data.summary) { toast("Ajoutez un résumé.", true); form.summary.focus(); return; }
        if (editor.textContent.trim().length < 50) { toast("Le texte de l'article est trop court.", true); editor.focus(); return; }
        confirmBox(online ? "Publier les modifications ?" : "Publier cet article ?",
          online ? "La version en ligne sera remplacée." : "Il sera visible de tous sur votre site.", "Publier").then(function (yes) {
          if (!yes) return;
          var button = $("#publish");
          busy(button, true, "Publication…");
          api("articles", "POST", data).then(function () {
            state.dirty = false;
            toast("Publié. L'article sera en ligne dans environ une minute.");
            go("articles");
          }).catch(function (err) { toast(err.message, true); busy(button, false); });
        });
      });
    }).catch(fail(view));
  }

  /* ---------- Statistiques ---------- */

  var PAGE_NAMES = {
    "/": "Accueil", "/articles": "Articles", "/faq": "Questions fréquentes", "/formations": "Formations",
    "/hypnotherapie": "Hypnothérapie — PTR", "/psychotherapie-emdr": "Psychothérapie EMDR",
    "/psychotherapie-generale": "Psychothérapie générale", "/consultations-en-ligne": "Consultations en ligne",
    "/coherence-cardiaque": "Cohérence cardiaque",
  };
  var nf = new Intl.NumberFormat("fr-BE");

  function rankTable(rows, nameOf) {
    if (!rows.length) return '<p class="empty">Pas encore de données.</p>';
    var max = rows[0].n || 1;
    return '<table class="rank"><tbody>' + rows.map(function (row) {
      return "<tr><td>" + esc(nameOf(row.key)) + '<div class="track"><div class="fill" style="width:' + Math.max(2, Math.round((row.n / max) * 100)) + '%"></div></div></td><td>' + nf.format(row.n) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }

  /* Haut de l'axe : quatre graduations entières et rondes. */
  function niceMax(value) {
    var step = Math.max(1, Math.ceil(value / 4));
    var pow = Math.pow(10, Math.floor(Math.log10(step)));
    var nice = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
    for (var i = 0; i < nice.length; i++) {
      var candidate = nice[i] * pow;
      if (candidate >= step && candidate % 1 === 0) return candidate * 4;
    }
    return step * 4;
  }

  /* Histogramme des visites par jour : une seule série, survol pour le détail. */
  function chart(series) {
    var W = 1000, H = 260, left = 38, right = 8, top = 12, bottom = 26;
    var plotW = W - left - right, plotH = H - top - bottom;
    var max = niceMax(Math.max.apply(null, series.map(function (d) { return d.visits; })));
    var step = plotW / series.length;
    var barW = Math.max(2, Math.min(22, step - 2));
    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Visites par jour">';
    for (var t = 0; t <= 4; t++) {
      var y = top + plotH - (plotH * t) / 4;
      svg += '<line class="grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + nf.format((max * t) / 4) + "</text>";
    }
    var labelEvery = Math.ceil(series.length / 8);
    series.forEach(function (d, i) {
      var h = d.visits ? Math.max(2, (d.visits / max) * plotH) : 0;
      var x = left + i * step + (step - barW) / 2;
      var yb = top + plotH;
      var r = Math.min(4, barW / 2, h);
      var bar = h ? '<path class="bar" d="M' + x + " " + yb + "V" + (yb - h + r) + "q0 -" + r + " " + r + " -" + r + "h" + (barW - 2 * r) + "q" + r + " 0 " + r + " " + r + "V" + yb + 'z"/>' : "";
      svg += '<g class="col" data-i="' + i + '" tabindex="0" role="listitem" aria-label="' + esc(frDate(d.day)) + " : " + d.visits + " visites, " + d.views + ' pages vues">' +
        '<rect class="hit" x="' + (left + i * step) + '" y="' + top + '" width="' + step + '" height="' + plotH + '"/>' + bar + "</g>";
      if (i % labelEvery === 0) {
        var p = d.day.split("-");
        svg += '<text x="' + (left + i * step + step / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + Number(p[2]) + "/" + Number(p[1]) + "</text>";
      }
    });
    return svg + "</svg>";
  }

  function viewStats(view, arg) {
    var days = (arg && arg.days) || 30;
    api("stats?days=" + days).then(function (data) {
      var visits = 0, views = 0;
      data.series.forEach(function (d) { visits += d.visits; views += d.views; });
      var ev = data.events;
      function tile(label, value, key) {
        return '<div class="tile' + (key ? " key" : "") + '"><div class="label">' + label + '</div><div class="value">' + nf.format(value || 0) + "</div></div>";
      }
      view.innerHTML =
        '<div class="page-head"><div><h1>Statistiques</h1><p>' +
        (data.since ? "Mesurées depuis le " + esc(frDate(data.since)) + ". Vos propres visites ne sont pas comptées." : "Les statistiques démarrent à la mise en ligne du site sur son adresse officielle.") +
        '</p></div><label class="field" style="margin:0"><span>Période</span><select id="range">' +
        [[7, "7 derniers jours"], [30, "30 derniers jours"], [90, "3 derniers mois"], [365, "12 derniers mois"]].map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === days ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></label></div>" +
        '<div class="tiles">' + tile("Visites", visits) + tile("Pages vues", views) +
        tile("Clics « Rendez-vous »", ev.rdv, true) + tile("Clics WhatsApp", ev.whatsapp) + tile("Clics e-mail", ev.email) + tile("Clics téléphone", ev.phone) + "</div>" +
        '<section class="card"><h2>Visites par jour</h2><p>Une visite correspond à une personne qui ouvre le site, quel que soit le nombre de pages consultées.</p>' +
        '<div class="chart-wrap" id="chart">' + chart(data.series) + '<div class="tip" hidden></div></div>' +
        '<table class="sr-only"><caption>Visites et pages vues par jour</caption><thead><tr><th>Jour</th><th>Visites</th><th>Pages vues</th></tr></thead><tbody>' +
        data.series.map(function (d) { return "<tr><td>" + esc(frDate(d.day)) + "</td><td>" + d.visits + "</td><td>" + d.views + "</td></tr>"; }).join("") +
        "</tbody></table></section>" +
        '<div class="grid-2"><section class="card"><h2>Pages les plus consultées</h2><p>En nombre de pages vues.</p>' +
        rankTable(data.pages, function (key) { return PAGE_NAMES[key] || key.replace(/^\/article-/, "Article : ").replace(/-/g, " "); }) + "</section>" +
        '<section class="card"><h2>Provenance des visiteurs</h2><p>Le site d\'où arrivent les visites.</p>' +
        rankTable(data.referrers, function (key) { return key === "direct" ? "Accès direct (adresse tapée, favori)" : key; }) + "</section></div>";

      $("#range").addEventListener("change", function () { go("stats", { days: Number(this.value) }); });

      var wrap = $("#chart"), tip = $(".tip", wrap);
      function show(col) {
        var d = data.series[Number(col.dataset.i)];
        var box = col.querySelector(".hit").getBoundingClientRect();
        var host = wrap.getBoundingClientRect();
        var bar = col.querySelector(".bar");
        var topY = bar ? bar.getBoundingClientRect().top : box.bottom;
        tip.innerHTML = "<strong>" + esc(frDate(d.day)) + "</strong><br>" + nf.format(d.visits) + " visite" + (d.visits > 1 ? "s" : "") + " · " + nf.format(d.views) + " page" + (d.views > 1 ? "s" : "") + " vue" + (d.views > 1 ? "s" : "");
        tip.hidden = false;
        var x = box.left + box.width / 2 - host.left;
        tip.style.left = Math.min(host.width - 90, Math.max(90, x)) + "px";
        tip.style.top = Math.max(34, topY - host.top - 8) + "px";
        $all(".col.active", wrap).forEach(function (c) { c.classList.remove("active"); });
        col.classList.add("active");
      }
      function hide() { tip.hidden = true; $all(".col.active", wrap).forEach(function (c) { c.classList.remove("active"); }); }
      $all(".col", wrap).forEach(function (col) {
        col.addEventListener("mouseenter", function () { show(col); });
        col.addEventListener("focus", function () { show(col); });
        col.addEventListener("blur", hide);
      });
      wrap.addEventListener("mouseleave", hide);
    }).catch(fail(view));
  }

  /* ---------- Annonce et réglages ---------- */

  function viewSite(view) {
    api("site").then(function (site) {
      view.innerHTML =
        '<div class="page-head"><div><h1>Annonce & réglages</h1><p>Les changements sont visibles sur le site environ une minute après l\'enregistrement.</p></div></div>' +
        '<form id="site-form" novalidate><section class="card"><h2>Bandeau d\'annonce</h2><p>Un message affiché en haut de toutes les pages : congés, changement d\'horaires…</p>' +
        '<label class="check"><input type="checkbox" name="active"' + (site.banner.active ? " checked" : "") + "/> Afficher le bandeau sur le site</label>" +
        '<label class="field"><span>Message</span><textarea name="text" rows="2" maxlength="240" placeholder="Le cabinet sera fermé du 23 décembre au 2 janvier.">' + esc(site.banner.text) + "</textarea></label>" +
        '<label class="field" style="max-width:260px"><span>Afficher jusqu\'au</span><input type="date" name="until" value="' + esc(site.banner.until) + '"/>' +
        "<small>Facultatif. Le bandeau disparaît tout seul après cette date.</small></label></section>" +
        '<section class="card"><h2>Écoute des articles</h2><p>Chaque article dispose d\'une version audio générée automatiquement.</p>' +
        '<label class="check"><input type="checkbox" name="audio"' + (site.audio ? " checked" : "") + "/> Afficher le bouton « Écouter » sur les articles</label></section>" +
        '<div class="row end"><button class="btn" type="submit">Enregistrer</button></div></form>';
      var form = $("#site-form");
      form.addEventListener("input", function () { state.dirty = true; });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var button = $("button[type=submit]", form);
        busy(button, true, "Enregistrement…");
        api("site", "POST", { banner: { active: form.active.checked, text: form.text.value, until: form.until.value }, audio: form.audio.checked })
          .then(function () { state.dirty = false; toast("Enregistré. Visible sur le site dans environ une minute."); })
          .catch(function (err) { toast(err.message, true); })
          .then(function () { busy(button, false); });
      });
    }).catch(fail(view));
  }

  /* ---------- Mon compte ---------- */

  function viewAccount(view) {
    view.innerHTML =
      '<div class="page-head"><div><h1>Mon compte</h1><p>Connecté en tant que ' + esc(state.email) + ".</p></div>" +
      '<button class="btn ghost" id="logout">Se déconnecter</button></div>' +
      '<section class="card" style="max-width:520px"><h2>Changer de mot de passe</h2><p>Vous serez déconnecté de vos autres appareils.</p>' +
      '<form id="password-form" novalidate><p class="error" role="alert" hidden></p>' +
      '<input type="email" autocomplete="username" value="' + esc(state.email) + '" hidden/>' +
      '<label class="field"><span>Mot de passe actuel</span><input type="password" name="current" autocomplete="current-password" required/></label>' +
      '<label class="field"><span>Nouveau mot de passe</span><input type="password" name="password" autocomplete="new-password" minlength="12" required/><small>Au moins 12 caractères.</small></label>' +
      '<label class="field"><span>Confirmez le nouveau mot de passe</span><input type="password" name="confirm" autocomplete="new-password" required/></label>' +
      '<button class="btn" type="submit">Changer le mot de passe</button></form></section>';
    $("#logout").addEventListener("click", function () {
      api("logout", "POST").then(function () { showLogin(); });
    });
    var form = $("#password-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var error = $(".error", form);
      var button = $("button", form);
      error.hidden = true;
      if (form.password.value.length < 12) { error.textContent = "Le nouveau mot de passe doit contenir au moins 12 caractères."; error.hidden = false; return; }
      if (form.password.value !== form.confirm.value) { error.textContent = "Les deux mots de passe ne sont pas identiques."; error.hidden = false; return; }
      busy(button, true);
      api("password", "POST", { current: form.current.value, password: form.password.value })
        .then(function () { form.reset(); toast("Mot de passe modifié."); })
        .catch(function (err) { error.textContent = err.message; error.hidden = false; })
        .then(function () { busy(button, false); });
    });
  }

  /* ---------- Démarrage ---------- */

  window.addEventListener("beforeunload", function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  api("session").then(function (session) {
    state.email = session.email || "";
    var setup = (location.hash.match(/setup=([\w-]+)/) || [])[1];
    if (setup) return showSetup(setup);
    if (session.authenticated) return enter();
    if (!session.passwordSet) {
      return authCard("<h1>Administration</h1><p class=\"intro\">Aucun mot de passe n'a encore été créé. Utilisez le lien de création qui vous a été transmis.</p>");
    }
    showLogin();
  }).catch(function (err) {
    app.innerHTML = '<p class="loading">' + esc(err.message) + "</p>";
  });
})();
