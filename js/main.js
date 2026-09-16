/* ============================================================
   My Anime Watch — season & episode browser.
   Reads one JSON file per season from data/ (01.json … 11.json)
   and renders a two-pane index: season list + episode log.

   The data files are fetched with fetch(), so the folder must
   be served over HTTP — opening index.html via file:// blocks
   local file reads in browsers.  From this directory run:

       python3 -m http.server 8000

   then open http://localhost:8000.
   ============================================================ */

(() => {
  "use strict";

  const DATA_FILES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((n) => `data/${n}.json`);

  const FRANCHISE = "Pokémon";

  const state = {
    seasons: [],
    current: 0,
    loaded: false,
    ep: null,      /* selected episode number in current season */
    track: null,   /* preferred audio track: "sub" | "dub" | null */
    video: null,   /* { number, track } of the video currently in the iframe */
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    brandTag: $("brand-tag"),
    seasonList: $("season-list"),
    seasonCount: $("season-count"),
    episodeList: $("episode-list"),
    episodeCount: $("episode-count"),
    heroCopy: $("hero-copy"),
    heroIndex: $("hero-index"),
    heroKicker: $("hero-kicker"),
    heroTitle: $("hero-title"),
    heroDesc: $("hero-desc"),
    heroDescWrap: $("hero-desc-wrap"),
    heroToggle: $("hero-toggle"),
    player: $("player"),
    playerStage: $("player-stage"),
    playerFrame: $("player-frame"),
    placeholderText: $("placeholder-text"),
    playerStatus: $("player-status"),
    playerEpisode: $("player-episode"),
    trackSub: $("track-sub"),
    trackDub: $("track-dub"),
    error: $("load-error"),
    retry: $("retry"),
  };

  const trackButtons = { sub: els.trackSub, dub: els.trackDub };

  /* ---------- text helpers ---------- */

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0" };

  function decodeEntities(value) {
    return String(value ?? "").replace(
      /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-z]+));/g,
      (match, hex, dec, name) => {
        if (name) return ENTITIES[name.toLowerCase()] ?? match;
        const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return "\uFFFD";
        }
      }
    );
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Decode HTML entities, drop source-credit footnotes, collapse whitespace. */
  function cleanText(value) {
    return decodeEntities(value)
      .replace(/\[Written by [^\]]*\]/gi, "")
      .replace(/\(Source: [^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const pad = (n, width = 2) => String(n).padStart(width, "0");
  const fmt = (n) => n.toLocaleString("en-US");

  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- data loading ---------- */

  async function loadSeasons() {
    const results = await Promise.allSettled(DATA_FILES.map(async (file) => {
      const response = await fetch(file, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${file} → HTTP ${response.status}`);
      const data = await response.json();
      return {
        file,
        seasonId: data.season_id,
        title: cleanText(data.title),
        description: cleanText(data.description),
        episodes: (Array.isArray(data.episodes) ? data.episodes : [])
          .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
          .map((ep) => ({
            number: ep.number,
            title: cleanText(ep.title),
            jpTitle: cleanText(ep.jp_title),
            sub: ep.embed_url ? ep.embed_url.sub : null,
            dub: ep.embed_url ? ep.embed_url.dub : null,
          })),
      };
    }));

    state.seasons = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    if (state.seasons.length === 0) {
      els.error.hidden = false;
      return false;
    }
    return true;
  }

  /* ---------- rendering ---------- */

  function renderSeasonList() {
    const totalEpisodes = state.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
    els.brandTag.textContent =
      `${FRANCHISE} · ${state.seasons.length} seasons · ${fmt(totalEpisodes)} episodes`;
    els.seasonCount.textContent = String(state.seasons.length);

    els.seasonList.innerHTML = state.seasons.map((season, i) => {
      const active = i === state.current;
      return [
        `<li><button type="button" class="season-item${active ? " is-active" : ""}" data-i="${i}"`,
        active ? ' aria-current="true"' : "",
        `>`,
        `<span class="season-idx">${pad(i + 1)}</span>`,
        `<span class="season-name">${esc(season.title)}</span>`,
        `<span class="season-count">${season.episodes.length}</span>`,
        `</button></li>`,
      ].join("");
    }).join("");

    Array.from(els.seasonList.querySelectorAll(".season-item")).forEach((btn) => {
      btn.addEventListener("click", () => selectSeason(Number(btn.dataset.i)));
    });
  }

  function updateSeasonList() {
    Array.from(els.seasonList.querySelectorAll(".season-item")).forEach((btn) => {
      const active = Number(btn.dataset.i) === state.current;
      btn.classList.toggle("is-active", active);
      if (active) {
        btn.setAttribute("aria-current", "true");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
  }

  function updateHero() {
    const season = state.seasons[state.current];
    const index = pad(state.current + 1);
    const clamped = season.description.length > 520;

    swapIn([els.heroCopy, els.heroDescWrap], () => {
      els.heroIndex.textContent = index;
      els.heroKicker.textContent = `Season ${index} · ${season.episodes.length} episodes`;
      els.heroTitle.textContent = season.title;
      els.heroDesc.textContent = season.description || "No synopsis available for this season.";
      els.heroDesc.classList.toggle("is-clamped", clamped);
      els.heroToggle.hidden = !clamped;
      els.heroToggle.textContent = "Show full synopsis";
    });
  }

  function updateEpisodeList() {
    const season = state.seasons[state.current];
    els.episodeCount.textContent = fmt(season.episodes.length);

    swapIn(els.episodeList, () => {
      els.episodeList.innerHTML = episodeRows(season);
      updateEpisodeSelection();
      els.episodeList.scrollTop = 0;
    });
  }

  function episodeRows(season) {
    if (!season.episodes.length) {
      return `<li class="note">No episodes listed for this season.</li>`;
    }
    return season.episodes.map((ep) => {
      const dupJp =
        !ep.jpTitle ||
        ep.jpTitle.toLowerCase() === ep.title.toLowerCase() ||
        /^episode\s*\d+$/i.test(ep.title);
      const trackBtn = (key, label, cls) =>
        ep[key]
          ? `<button type="button" class="ep-link ${cls}" data-track="${key}" aria-label="${esc(ep.title)} — ${label}">${label}</button>`
          : "";
      return [
        `<li class="episode-item" data-num="${ep.number}">`,
        `<span class="ep-num">${pad(ep.number, 3)}</span>`,
        `<span class="ep-text"><span class="ep-title">${esc(ep.title)}</span>`,
        dupJp ? "" : `<span class="ep-jp">${esc(ep.jpTitle)}</span>`,
        `</span>`,
        trackBtn("sub", "SUB", "is-sub"),
        trackBtn("dub", "DUB", "is-dub"),
        `</li>`,
      ].join("");
    }).join("");
  }

  function getEpisode(number) {
    const season = state.seasons[state.current];
    return (season && season.episodes.find((ep) => ep.number === number)) || null;
  }

  function selectEpisode(episode, autoplay) {
    state.ep = episode.number;
    updateEpisodeSelection();
    syncPlayer(episode, autoplay);
  }

  function updateEpisodeSelection() {
    Array.from(els.episodeList.querySelectorAll(".episode-item")).forEach((row) => {
      row.classList.toggle("is-selected", Number(row.dataset.num) === state.ep);
    });
  }

  function syncPlayer(episode, autoplay) {
    updatePlayerControls(episode);
    if (autoplay) {
      loadVideo(episode);
      return;
    }
    els.playerEpisode.textContent = `Ready · EP ${pad(episode.number, 3)} — ${episode.title}`;
    if (state.video && state.video.number !== episode.number) stopVideo();
    els.placeholderText.textContent =
      episode.sub || episode.dub
        ? `Ready: EP ${pad(episode.number, 3)} — press Sub or Dub to play`
        : "No stream available for this episode.";
  }

  function loadVideo(episode) {
    const track = state.track === "dub" ? "dub" : "sub";
    const url = episode[track];
    if (!url) {
      stopVideo();
      els.playerEpisode.textContent = `Ready · EP ${pad(episode.number, 3)} — ${episode.title}`;
      els.placeholderText.textContent = "No stream available for this episode.";
      return;
    }
    if (state.video && state.video.number === episode.number && state.video.track === track) return;
    els.playerFrame.src = url;
    state.video = { number: episode.number, track };
    els.playerStage.classList.add("is-playing");
    els.playerStatus.dataset.state = "playing";
    els.playerStatus.textContent = "PLAYING";
    els.playerEpisode.textContent = `Playing · EP ${pad(episode.number, 3)} — ${episode.title}`;
    updatePlayerControls(episode);
  }

  function stopVideo() {
    if (els.playerFrame.getAttribute("src") && els.playerFrame.getAttribute("src") !== "about:blank") {
      els.playerFrame.src = "about:blank";
    }
    state.video = null;
    els.playerStage.classList.remove("is-playing");
    els.playerStatus.dataset.state = "standby";
    els.playerStatus.textContent = "STANDBY";
  }

  function updatePlayerControls(episode) {
    ["sub", "dub"].forEach((track) => {
      const btn = trackButtons[track];
      btn.disabled = !episode[track];
      btn.setAttribute("aria-pressed", String(!!episode[track] && state.track === track));
    });
  }

  function resetPlayer() {
    stopVideo();
    state.ep = null;
    els.playerEpisode.textContent = "No episode selected";
    els.placeholderText.textContent = "Pick an episode, then press Sub or Dub.";
    updatePlayerControls({ sub: null, dub: null });
  }

  /* ---------- selection + motion ---------- */

  function swapIn(target, apply) {
    const targets = Array.isArray(target) ? target : [target];
    if (reduceMotion) {
      apply();
      return;
    }
    targets.forEach((el) => el.classList.add("is-swapping"));
    setTimeout(() => {
      apply();
      targets.forEach((el) => el.classList.remove("is-swapping"));
    }, 160);
  }

  function selectSeason(i) {
    if (i < 0 || i >= state.seasons.length || (i === state.current && state.loaded)) return;
    const seasonChanged = i !== state.current;
    state.current = i;
    state.loaded = true;
    if (seasonChanged) resetPlayer();
    updateSeasonList();
    updateHero();
    updateEpisodeList();
  }

  /* ---------- init ---------- */

  /* ---------- player interactions ---------- */

  els.episodeList.addEventListener("click", (event) => {
    const trackBtn = event.target.closest(".ep-link");
    const row = event.target.closest(".episode-item");
    if (!row) return;
    const episode = getEpisode(Number(row.dataset.num));
    if (!episode) return;
    if (trackBtn) {
      state.track = trackBtn.dataset.track;
      selectEpisode(episode, true);
      els.player.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
    } else {
      selectEpisode(episode, false);
    }
  });

  Object.values(trackButtons).forEach((btn) => {
    btn.addEventListener("click", () => {
      const episode = getEpisode(state.ep);
      if (!episode) return;
      state.track = btn.dataset.track;
      selectEpisode(episode, true);
    });
  });

  els.retry.addEventListener("click", () => {
    els.error.hidden = true;
    els.seasonList.innerHTML = `<li class="note">Loading seasons…</li>`;
    els.episodeList.innerHTML = `<li class="note">Loading episodes…</li>`;
    els.episodeCount.textContent = "…";
    void init();
  });

  els.heroToggle.addEventListener("click", () => {
    const expanding = els.heroDesc.classList.contains("is-clamped");
    els.heroDesc.classList.toggle("is-clamped", !expanding);
    els.heroToggle.textContent = expanding ? "Hide synopsis" : "Show full synopsis";
  });

  async function init() {
    const ok = await loadSeasons();
    if (!ok) return;
    renderSeasonList();
    selectSeason(0);
  }

  void init();
})();