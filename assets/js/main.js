/* Gautier Delvaux — interactions */
(function () {
  "use strict";

  /* Sticky header shadow */
  var header = document.querySelector(".site-header");
  function onScroll() {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 10);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mobile menu */
  var burger = document.querySelector(".burger");
  var mobileMenu = document.querySelector(".mobile-menu");
  if (burger && mobileMenu) {
    burger.addEventListener("click", function () {
      var open = mobileMenu.classList.toggle("open");
      burger.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
    mobileMenu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        mobileMenu.classList.remove("open");
        burger.classList.remove("open");
        document.body.style.overflow = "";
      });
    });
  }

  /* Panneau e-mail : adresse à copier + ouverture dans une messagerie */
  var emailToggle = document.querySelector("[data-email-toggle]");
  if (emailToggle) {
    var address = (emailToggle.getAttribute("href") || "").replace(/^mailto:/, "");
    var panel = document.createElement("div");
    panel.className = "email-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Écrire un e-mail");
    panel.innerHTML =
      '<div class="ep-label">E-mail</div>' +
      '<div class="ep-address"><span></span><button type="button" class="ep-copy">Copier</button></div>' +
      '<div class="ep-label">Ouvrir dans…</div>' +
      '<div class="ep-options">' +
        '<a data-ep="app">Mon application de messagerie</a>' +
        '<a data-ep="gmail" target="_blank" rel="noopener">Gmail</a>' +
        '<a data-ep="outlook" target="_blank" rel="noopener">Outlook</a>' +
      "</div>";
    var to = encodeURIComponent(address);
    panel.querySelector(".ep-address span").textContent = address;
    panel.querySelector('[data-ep="app"]').href = "mailto:" + address;
    panel.querySelector('[data-ep="gmail"]').href = "https://mail.google.com/mail/?view=cm&fs=1&to=" + to;
    panel.querySelector('[data-ep="outlook"]').href = "https://outlook.live.com/mail/0/deeplink/compose?to=" + to;
    emailToggle.parentNode.appendChild(panel);

    var copyBtn = panel.querySelector(".ep-copy");
    var copyTimer = null;
    function setPanel(open) {
      panel.classList.toggle("open", open);
      emailToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function copied(ok) {
      copyBtn.textContent = ok ? "Copié ✓" : "Sélectionnez l'adresse";
      copyBtn.classList.toggle("done", ok);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyBtn.textContent = "Copier";
        copyBtn.classList.remove("done");
      }, 2200);
    }
    function legacyCopy() {
      var field = document.createElement("textarea");
      field.value = address;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(field);
      copied(ok);
    }
    emailToggle.addEventListener("click", function (event) {
      event.preventDefault();
      setPanel(!panel.classList.contains("open"));
    });
    copyBtn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(function () { copied(true); }, legacyCopy);
      } else {
        legacyCopy();
      }
    });
    panel.querySelectorAll(".ep-options a").forEach(function (a) {
      a.addEventListener("click", function () { setPanel(false); });
    });
    document.addEventListener("click", function (event) {
      if (!panel.contains(event.target) && !emailToggle.contains(event.target)) setPanel(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel.classList.contains("open")) {
        setPanel(false);
        emailToggle.focus();
      }
    });
  }

  /* Active nav state */
  var path = location.pathname.split("/").pop() || "index.html";
  if (path.indexOf(".") === -1) path += ".html";
  document.querySelectorAll(".main-nav a, .mobile-menu a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (!href || href.indexOf("http") === 0 || href.indexOf("#") === 0) return;
    if (href === path) a.classList.add("active");
  });

  /* Reveal on scroll */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("visible"); });
  }

  /* FAQ accordions */
  document.querySelectorAll(".accordion-item").forEach(function (item) {
    var trigger = item.querySelector(".accordion-trigger");
    var panel = item.querySelector(".accordion-panel");
    if (!trigger || !panel) return;
    trigger.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      item.classList.toggle("open", !isOpen);
      trigger.setAttribute("aria-expanded", !isOpen ? "true" : "false");
      panel.style.maxHeight = !isOpen ? panel.scrollHeight + "px" : "0px";
    });
  });

  /* Écoute des articles
     Les audios sont générés automatiquement (scripts/generate-audio.mjs) et
     listés dans assets/audio/manifest.json. Un bouton « Écouter » est ajouté
     aux cartes d'articles et aux pages d'article qui ont un audio. */
  function initAudio() {
    var cards = document.querySelectorAll(".article-card");
    var articleBody = document.querySelector(".article-body");
    if ((!cards.length && !articleBody) || !window.fetch) return;

    var ICONS =
      '<svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6a.6.6 0 0 0 .92.5l9-5.8a.6.6 0 0 0 0-1L4.92 1.7A.6.6 0 0 0 4 2.2z"/></svg>' +
      '<svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>';
    var SPEEDS = [1, 1.25, 1.5, 0.85];

    var manifest = {};
    var buttons = [];
    var audio = null;
    var dock = null;
    var current = null;
    var speedIndex = 0;
    var seeking = false;

    function slugOf(href) {
      return (href || "").split("#")[0].split("?")[0].split("/").pop().replace(/\.html$/, "");
    }
    function clock(seconds) {
      if (!isFinite(seconds) || seconds < 0) seconds = 0;
      var m = Math.floor(seconds / 60);
      var s = Math.floor(seconds % 60);
      return m + ":" + (s < 10 ? "0" : "") + s;
    }
    function minutes(seconds) {
      return Math.max(1, Math.round(seconds / 60)) + " min";
    }
    function store(key, value) {
      try {
        if (value === undefined) return window.localStorage.getItem(key);
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch (e) { /* stockage indisponible : on s'en passe */ }
      return null;
    }

    function makeButton(slug, label) {
      var entry = manifest[slug];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "listen-btn";
      btn.innerHTML =
        '<span class="listen-icon">' + ICONS + "</span>" +
        '<span class="listen-label"></span>' +
        (entry.duration ? '<span class="listen-time">' + minutes(entry.duration) + "</span>" : "");
      btn.dataset.slug = slug;
      btn.dataset.label = label;
      btn.addEventListener("click", function () { toggle(slug); });
      buttons.push(btn);
      return btn;
    }

    function buildDock() {
      dock = document.createElement("div");
      dock.className = "audio-dock";
      dock.setAttribute("role", "region");
      dock.setAttribute("aria-label", "Lecteur audio");
      dock.innerHTML =
        '<div class="audio-dock-inner">' +
          '<button type="button" class="dock-toggle" aria-label="Lecture">' + ICONS + "</button>" +
          '<div class="dock-title"></div>' +
          '<div class="dock-side">' +
            '<button type="button" class="dock-speed" aria-label="Vitesse de lecture">1×</button>' +
            '<button type="button" class="dock-close" aria-label="Fermer le lecteur">×</button>' +
          "</div>" +
          '<div class="dock-progress">' +
            '<span class="dock-current">0:00</span>' +
            '<input type="range" min="0" max="100" step="1" value="0" aria-label="Position dans l\'article"/>' +
            '<span class="dock-total">0:00</span>' +
          "</div>" +
          '<div class="dock-error" role="alert" hidden>L\'audio n\'a pas pu être chargé. Réessayez dans un instant.</div>' +
        "</div>";
      document.body.appendChild(dock);

      var range = dock.querySelector("input");
      dock.querySelector(".dock-toggle").addEventListener("click", function () { toggle(current); });
      dock.querySelector(".dock-close").addEventListener("click", close);
      dock.querySelector(".dock-speed").addEventListener("click", function () {
        speedIndex = (speedIndex + 1) % SPEEDS.length;
        audio.playbackRate = SPEEDS[speedIndex];
        this.textContent = String(SPEEDS[speedIndex]).replace(".", ",") + "×";
      });
      range.addEventListener("input", function () {
        seeking = true;
        dock.querySelector(".dock-current").textContent = clock(Number(range.value));
      });
      range.addEventListener("change", function () {
        audio.currentTime = Number(range.value);
        seeking = false;
      });

      audio = new Audio();
      audio.preload = "none";
      audio.addEventListener("play", render);
      audio.addEventListener("pause", render);
      audio.addEventListener("loadedmetadata", render);
      audio.addEventListener("timeupdate", function () {
        render();
        if (current && audio.currentTime > 5) store("audio-pos:" + current, String(Math.floor(audio.currentTime)));
      });
      audio.addEventListener("ended", function () {
        store("audio-pos:" + current, null);
        audio.currentTime = 0;
        render();
      });
      audio.addEventListener("error", function () {
        if (!current) return;
        dock.querySelector(".dock-error").hidden = false;
        render();
      });
    }

    function total() {
      if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
      return (current && manifest[current].duration) || 0;
    }

    function render() {
      var playing = !!audio && !audio.paused && !audio.ended;
      buttons.forEach(function (btn) {
        var active = playing && btn.dataset.slug === current;
        btn.classList.toggle("playing", active);
        btn.querySelector(".listen-label").textContent = active ? "Pause" : btn.dataset.label;
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (!dock) return;
      dock.classList.toggle("playing", playing);
      dock.querySelector(".dock-toggle").setAttribute("aria-label", playing ? "Pause" : "Lecture");
      var range = dock.querySelector("input");
      var duration = total();
      range.max = String(Math.max(1, Math.floor(duration)));
      if (!seeking) {
        range.value = String(Math.floor(audio.currentTime));
        dock.querySelector(".dock-current").textContent = clock(audio.currentTime);
      }
      range.setAttribute("aria-valuetext", clock(audio.currentTime) + " sur " + clock(duration));
      dock.querySelector(".dock-total").textContent = clock(duration);
    }

    function toggle(slug) {
      if (!slug || !manifest[slug]) return;
      if (!dock) buildDock();
      if (current !== slug) {
        var entry = manifest[slug];
        current = slug;
        audio.src = entry.src;
        audio.playbackRate = SPEEDS[speedIndex];
        dock.querySelector(".dock-title").textContent = entry.title || "";
        dock.querySelector(".dock-error").hidden = true;
        var saved = Number(store("audio-pos:" + slug));
        if (saved > 5 && (!entry.duration || saved < entry.duration - 10)) {
          audio.addEventListener("loadedmetadata", function () { audio.currentTime = saved; }, { once: true });
        }
        if ("mediaSession" in navigator && window.MediaMetadata) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: entry.title || "Article",
            artist: "Gautier Delvaux — Psychologue clinicien",
          });
        }
      }
      dock.classList.add("open");
      document.body.classList.add("has-audio-dock");
      if (audio.paused) {
        dock.querySelector(".dock-error").hidden = true;
        var started = audio.play();
        if (started && started.catch) started.catch(function () { render(); });
      } else {
        audio.pause();
      }
      render();
    }

    function close() {
      audio.pause();
      dock.classList.remove("open");
      document.body.classList.remove("has-audio-dock");
      render();
    }

    fetch("assets/audio/manifest.json", { cache: "no-cache" })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (data) {
        manifest = data || {};
        cards.forEach(function (card) {
          var link = card.querySelector(".article-link");
          var actions = card.querySelector(".card-actions");
          var slug = link && slugOf(link.getAttribute("href"));
          if (!actions || !slug || !manifest[slug]) return;
          var btn = makeButton(slug, "Écouter");
          btn.setAttribute("aria-label", "Écouter l'article : " + link.textContent.trim());
          actions.appendChild(btn);
        });
        if (articleBody) {
          var slug = slugOf(location.pathname);
          var heading = document.querySelector(".page-hero h1");
          if (heading && manifest[slug]) {
            heading.insertAdjacentElement("afterend", makeButton(slug, "Écouter l'article"));
          }
        }
        render();
      })
      .catch(function () { /* pas d'audio disponible : le site reste inchangé */ });
  }

  /* Réglages modifiables depuis l'espace d'administration (assets/data/site.json) :
     bandeau d'annonce et activation de l'écoute des articles. */
  var script = document.currentScript;
  var siteRoot = script && script.src ? new URL("../../", script.src).href : "";
  if (window.fetch) {
    fetch(siteRoot + "assets/data/site.json", { cache: "no-cache" })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (site) {
        if (site.audio) initAudio();
        showBanner(site.banner);
      })
      .catch(function () { /* réglages indisponibles : le site reste inchangé */ });
  }

  function showBanner(banner) {
    if (!banner || !banner.active || !banner.text) return;
    var now = new Date();
    var today = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
    if (banner.until && today > banner.until) return;
    var key = "gd-banner:" + banner.text;
    try { if (window.sessionStorage.getItem(key)) return; } catch (e) { /* stockage indisponible */ }
    var bar = document.createElement("div");
    bar.className = "site-banner";
    bar.setAttribute("role", "status");
    var text = document.createElement("span");
    text.textContent = banner.text;
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer l'annonce");
    close.textContent = "×";
    close.addEventListener("click", function () {
      bar.remove();
      try { window.sessionStorage.setItem(key, "1"); } catch (e) { /* stockage indisponible */ }
    });
    bar.appendChild(text);
    bar.appendChild(close);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* Statistiques de fréquentation : compteur maison, sans cookie ni donnée personnelle.
     Seuls des totaux sont envoyés (page vue, nouvelle visite, site d'origine, clic de contact). */
  (function () {
    var host = location.hostname;
    if (!/(^|\.)gautierdelvaux\.be$/.test(host) && host !== "localhost" && host !== "127.0.0.1") return;
    try { if (window.localStorage.getItem("gd_no_stats")) return; } catch (e) { /* stockage indisponible */ }
    function send(data) {
      var payload = JSON.stringify(data);
      try {
        if (navigator.sendBeacon) navigator.sendBeacon("/api/hit", new Blob([payload], { type: "text/plain" }));
        else if (window.fetch) fetch("/api/hit", { method: "POST", body: payload, keepalive: true });
      } catch (e) { /* envoi impossible : sans conséquence */ }
    }
    var newVisit = false;
    try {
      if (!window.sessionStorage.getItem("gd_visit")) {
        newVisit = true;
        window.sessionStorage.setItem("gd_visit", "1");
      }
    } catch (e) { /* stockage indisponible */ }
    var referrer = "";
    try { if (document.referrer) referrer = new URL(document.referrer).hostname; } catch (e) { /* référent illisible */ }
    send({ p: location.pathname, v: newVisit ? 1 : 0, r: referrer });

    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[href]");
      if (!link || link.closest(".email-panel")) return;
      var href = link.getAttribute("href");
      var kind = href.indexOf("doctoranytime") > -1 ? "rdv"
        : href.indexOf("wa.me") > -1 ? "whatsapp"
        : href.indexOf("mailto:") === 0 ? "email"
        : href.indexOf("tel:") === 0 ? "phone" : null;
      if (kind) send({ e: kind });
    }, true);
  })();

  /* Current year */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
