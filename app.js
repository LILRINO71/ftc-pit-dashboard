(() => {
  "use strict";

  const API = "https://api.ftcscout.org/rest/v1";
  const DEMO = { season: 2025, event: "USALCMP", team: 24180 };
  const VIEWS = ["dash", "judge", "timer", "check", "settings"];
  const $ = (id) => document.getElementById(id);
  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="#0c0d0f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("pit:" + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("pit:" + key, JSON.stringify(value)); } catch {}
    },
  };

  // ---------- config: config.js < saved settings < URL params ----------
  const base = window.PIT_CONFIG || {};
  const saved = store.get("settings", {});
  const url = new URLSearchParams(location.search);
  const cfg = Object.assign({ season: 2026, refreshSeconds: 60, queueWhenMatchesAway: 3 }, base, saved);
  for (const k of ["team", "event", "season"]) if (url.get(k)) cfg[k] = url.get(k);
  if (url.has("demo")) cfg.demo = url.get("demo") !== "0";
  if (!cfg.team && !cfg.event && cfg.demo === undefined) cfg.demo = true;
  cfg.team = cfg.team ? Number(cfg.team) : null;
  cfg.season = Number(cfg.season) || 2026;
  cfg.timer = Object.assign({ auto: 30, transition: 8, teleop: 120, endgame: 20 }, base.timer);

  const src = () => (cfg.demo ? DEMO : { season: cfg.season, event: cfg.event, team: cfg.team });

  // Live blur only off the Pi (ARM Linux Chromium can't afford backdrop-filter)
  const weak = /armv7|aarch64|arm64/i.test(navigator.userAgent) && /Linux/i.test(navigator.userAgent);
  if (url.get("fx") === "1" || (!weak && url.get("fx") !== "0")) document.documentElement.classList.add("fx");

  // In demo mode the clock is shifted back into a real past event
  let clockOffset = 0;
  const now = () => Date.now() + clockOffset;

  const state = { event: null, matches: [], ranks: [], roster: [], scout: store.get("scout", {}), names: store.get("names", {}), lastOk: 0, error: false };

  // ---------- API with offline cache ----------
  async function api(path) {
    const key = "cache:" + path;
    try {
      const res = await fetch(API + path, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      store.set(key, { t: Date.now(), data });
      return data;
    } catch (e) {
      const hit = store.get(key, null);
      if (hit) { state.error = true; return hit.data; }
      throw e;
    }
  }

  async function inBatches(list, fn) {
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(fn));
  }

  async function loadNames(numbers) {
    const missing = numbers.filter((n) => !state.names[n]);
    await inBatches(missing, async (n) => {
      try { state.names[n] = (await api("/teams/" + n)).name; } catch {}
    });
    if (missing.length) store.set("names", state.names);
  }

  // Before the schedule is out: each team's best showing earlier this season
  async function loadScouting(numbers) {
    const s = src();
    const stale = (n) => !state.scout[n] || Date.now() - state.scout[n].t > 30 * 60000;
    await inBatches(numbers.filter(stale), async (n) => {
      try {
        const evs = await api(`/teams/${n}/events/${s.season}`);
        let best = null;
        for (const e of evs) {
          if (e.eventCode === s.event || !e.stats || !e.stats.opr) continue;
          const o = e.stats.opr.totalPointsNp;
          if (!best || o > best.opr) best = { opr: o, rank: e.stats.rank, w: e.stats.wins, l: e.stats.losses, t: e.stats.ties, event: e.eventCode };
        }
        state.scout[n] = { t: Date.now(), best };
      } catch {}
    });
    store.set("scout", state.scout);
  }

  async function load() {
    const s = src();
    if (s.team) loadNames([s.team]).then(renderTop);
    if (!s.event) { renderAll(); return; }
    state.error = false;
    try {
      const [ev, matches, ranks] = await Promise.all([
        api(`/events/${s.season}/${s.event}`),
        api(`/events/${s.season}/${s.event}/matches`),
        api(`/events/${s.season}/${s.event}/teams`),
      ]);
      state.event = ev;
      state.matches = (matches || []).slice().sort(byTime);
      state.roster = (ranks || []).map((t) => t.teamNumber);
      state.ranks = (ranks || []).filter((t) => t.stats).sort((a, b) => a.stats.rank - b.stats.rank);
      if (!state.error) state.lastOk = Date.now();
      if (cfg.demo && !clockOffset) setDemoClock();
      renderAll();
      await loadNames(state.roster);
      if (!state.ranks.length && state.roster.length) await loadScouting(state.roster);
      renderAll();
    } catch (e) {
      state.error = true;
      renderAll();
    }
  }

  // Park the demo clock 7 minutes before our 4th qual match
  function setDemoClock() {
    const ours = state.matches.filter((m) => allianceOf(m) && m.scheduledStartTime);
    const pick = ours[Math.min(3, ours.length - 1)];
    if (pick) clockOffset = new Date(pick.scheduledStartTime).getTime() - 7 * 60000 - Date.now();
  }

  // ---------- match helpers ----------
  const levelRank = { Quals: 0, Playoff: 1, DoubleElim: 1, Semis: 1, Finals: 2 };
  function byTime(a, b) {
    const ta = a.scheduledStartTime ? Date.parse(a.scheduledStartTime) : Infinity;
    const tb = b.scheduledStartTime ? Date.parse(b.scheduledStartTime) : Infinity;
    return (levelRank[a.tournamentLevel] ?? 1) - (levelRank[b.tournamentLevel] ?? 1) || ta - tb || a.id - b.id;
  }
  function played(m) {
    if (cfg.demo) return m.scheduledStartTime && Date.parse(m.scheduledStartTime) + 4 * 60000 <= now();
    return m.hasBeenPlayed;
  }
  function allianceOf(m, team = src().team) {
    const t = (m.teams || []).find((x) => x.teamNumber === team);
    return t ? t.alliance : null;
  }
  function label(m) {
    if (m.tournamentLevel === "Quals") return "Q" + m.id;
    if (m.series) return "M" + m.series;
    return "F" + (m.id % 100 || 1);
  }
  function score(m, alliance) {
    const s = m.scores && m.scores[alliance.toLowerCase()];
    return s ? s.totalPoints : null;
  }
  function result(m, alliance) {
    const us = score(m, alliance);
    const them = score(m, alliance === "Red" ? "Blue" : "Red");
    if (us == null || them == null) return null;
    return { us, them, r: us > them ? "W" : us < them ? "L" : "T" };
  }
  const rankOf = (n) => state.ranks.find((t) => t.teamNumber === n);
  const opr = (n) => {
    const r = rankOf(n);
    if (r && r.stats.opr) return r.stats.opr.totalPointsNp;
    const sc = state.scout[n];
    return sc && sc.best ? sc.best.opr : null;
  };
  const tz = () => (state.event && state.event.timezone) || undefined;
  const fmtTime = (iso) => iso ? new Date(Date.parse(iso)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz() }) : "TBD";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const teamName = (n) => (n === cfg.team && cfg.teamName) ? cfg.teamName : (state.names[n] || "");

  function ourMatches() { return state.matches.filter((m) => allianceOf(m)); }
  function nextMatch() { return ourMatches().find((m) => !played(m)) || null; }

  // ---------- rendering ----------
  function renderAll() {
    renderTop();
    renderNext();
    renderStats();
    renderSchedule();
    renderRankings();
  }

  function renderTop() {
    const s = src();
    $("teamNum").textContent = s.team || "----";
    $("teamName").textContent = s.team ? (teamName(s.team) || "Team " + s.team) : "Set your team";
    const ev = state.event;
    $("eventName").textContent = (cfg.demo ? "Demo · " : "") + (ev ? ev.name : s.event || "No event selected");
    $("eventSub").textContent = ev ? [ev.venue, fmtDay(ev.start)].filter(Boolean).join(" · ") : "";
    tickStatus();
  }
  function fmtDay(d) {
    if (!d) return "";
    return new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  function tickStatus() {
    const dot = $("statusDot");
    const txt = $("statusText");
    if (!src().event) { dot.className = "dot"; txt.textContent = "no event"; return; }
    const age = state.lastOk ? Math.round((Date.now() - state.lastOk) / 60000) : null;
    if (state.error && age == null) { dot.className = "dot err"; txt.textContent = "offline"; }
    else if (state.error) { dot.className = "dot stale"; txt.textContent = `cached ${age}m ago`; }
    else { dot.className = "dot live"; txt.textContent = age ? `live · ${age}m` : "live"; }
  }

  function teamChip(n, isUs) {
    const r = rankOf(n);
    const o = opr(n);
    const nm = teamName(n);
    return `<div class="tm${isUs ? " us" : ""}"><b>${n}</b>${o != null ? `<span class="op">OPR ${o.toFixed(0)}</span>` : "<span></span>"}` +
      `<span class="nm">${esc(nm || "—")}${r ? " · #" + r.stats.rank : ""}</span></div>`;
  }

  function renderNext() {
    const m = nextMatch();
    const card = $("nextCard");
    card.classList.remove("red", "blue");
    $("vs").hidden = !m;
    $("predict").textContent = "";
    renderWatch(!m && !ourMatches().length);
    if (!m) {
      $("nextAlliance").textContent = "";
      $("nextAlliance").className = "alliance-tag";
      const ev = state.event;
      if (!src().event) { $("nextTitle").textContent = "Next match"; $("nextLabel").textContent = "--"; $("nextAway").textContent = "Pick an event in Settings (S)"; }
      else if (ourMatches().length) { $("nextTitle").textContent = "Next match"; $("nextLabel").textContent = "Done"; $("nextAway").textContent = "No more matches scheduled. Pack the pit."; }
      else {
        $("nextTitle").textContent = "Schedule not posted yet";
        $("nextLabel").textContent = ev ? fmtDay(ev.start) : "--";
        $("nextAway").textContent = state.roster.length ? `Until 8 AM on event day. ${state.roster.length} teams registered; the match list usually drops that morning.` : "";
      }
      tickCountdown();
      return;
    }
    $("nextTitle").textContent = "Next match";
    const all = allianceOf(m);
    const other = all === "Red" ? "Blue" : "Red";
    const cls = all.toLowerCase();
    card.classList.add(cls);
    $("nextLabel").textContent = label(m);
    $("nextAlliance").textContent = all.toUpperCase() + " ALLIANCE";
    $("nextAlliance").className = "alliance-tag " + cls;
    const usTeams = m.teams.filter((t) => t.alliance === all).map((t) => t.teamNumber);
    const themTeams = m.teams.filter((t) => t.alliance === other).map((t) => t.teamNumber);
    $("nextUs").className = "side " + cls;
    $("nextThem").className = "side " + other.toLowerCase();
    $("nextUs").innerHTML = `<span class="side-title"><i class="swatch"></i>Us + partner</span>` + usTeams.map((n) => teamChip(n, n === src().team)).join("");
    $("nextThem").innerHTML = `<span class="side-title"><i class="swatch"></i>Opponents</span>` + themTeams.map((n) => teamChip(n)).join("");

    const sum = (ts) => ts.reduce((a, n) => (a == null || opr(n) == null ? null : a + opr(n)), 0);
    const a = sum(usTeams), b = sum(themTeams);
    if (a != null && b != null) {
      $("predict").innerHTML = `OPR says <b>${a.toFixed(0)}</b> to <b>${b.toFixed(0)}</b>. ` +
        (Math.abs(a - b) < 5 ? "Coin flip. Auto decides it." : a > b ? "We're favored, play clean." : "Underdogs. Play smart and avoid penalties.");
    }
    tickCountdown();
  }

  // Before the schedule: the strongest teams here, likely partners or threats
  function renderWatch(on) {
    const box = $("watch");
    const top = state.roster.filter((n) => n !== src().team && opr(n) != null)
      .sort((a, b) => opr(b) - opr(a)).slice(0, 4);
    box.hidden = !on || !top.length;
    if (box.hidden) return;
    box.innerHTML = `<span class="side-title">Teams to watch</span><div class="watch-grid">${top.map((n) => teamChip(n)).join("")}</div>`;
  }

  function fmtLeft(ms) {
    const t = Math.floor(ms / 1000);
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    if (d) return `${d}d ${h}h`;
    return (h ? h + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0");
  }

  function tickCountdown() {
    const m = nextMatch();
    tickProgress(m);
    const cd = $("countdown");
    const banner = $("queueBanner");
    cd.classList.remove("small");
    if (!m) {
      banner.hidden = true;
      cd.classList.remove("soon");
      const ev = state.event;
      if (ev && ev.start && !ourMatches().length) {
        // Count down to 8 AM on event day
        const target = Date.parse(ev.start + "T08:00:00");
        const ms = target - now();
        cd.textContent = ms > 0 ? fmtLeft(ms) : "Today";
        cd.classList.add("small");
      } else cd.textContent = "--:--";
      return;
    }
    const away = state.matches.filter((x) => !played(x) && byTime(x, m) < 0).length;
    if (m.scheduledStartTime) {
      const ms = Date.parse(m.scheduledStartTime) - now();
      cd.textContent = ms > 0 ? fmtLeft(ms) : "Any min";
      cd.classList.toggle("small", ms <= 0 || ms >= 86400000);
      cd.classList.toggle("soon", ms < 10 * 60000);
    } else cd.textContent = "TBD";
    $("nextAway").textContent = (away === 0 ? "We're up next." : `${away} match${away === 1 ? "" : "es"} before ours`) +
      (m.scheduledStartTime ? ` · scheduled ${fmtTime(m.scheduledStartTime)}` : "");
    const q = away < (cfg.queueWhenMatchesAway || 3);
    banner.hidden = !q;
    if (q) banner.textContent = `QUEUE NOW · ${label(m)} · ${away === 0 ? "WE'RE NEXT" : away + " AWAY"}`;
  }

  function tickProgress(m) {
    const all = state.matches;
    const onField = all.find((x) => !played(x));
    const done = all.filter(played).length;
    $("pNow").textContent = onField ? "On field: " + label(onField) : all.length ? "Event complete" : "No matches yet";
    $("pCount").textContent = all.length ? `${done} of ${all.length} played` : "";
    $("pFill").style.width = all.length ? (100 * done / all.length) + "%" : "0";
    const i = m ? all.indexOf(m) : -1;
    $("pUs").style.display = i < 0 ? "none" : "";
    if (i >= 0) $("pUs").style.left = (100 * i / all.length) + "%";
  }

  function renderStats() {
    const r = rankOf(src().team);
    const games = ourMatches().filter(played).map((m) => ({ m, res: result(m, allianceOf(m)) })).filter((g) => g.res);
    const scores = games.map((g) => g.res.us);
    const prev = !games.length && !r && state.scout[src().team] && state.scout[src().team].best;
    if (prev) {
      // Nothing played here yet: show our best earlier event
      $("statsTitle").textContent = "Season so far";
      $("sRank").textContent = "#" + prev.rank;
      $("sRecord").textContent = `${prev.w}-${prev.l}-${prev.t}`;
      $("sOpr").textContent = prev.opr.toFixed(1);
      $("sAvg").textContent = "-";
      $("sBest").textContent = "-";
    } else {
      const w = games.filter((g) => g.res.r === "W").length;
      const l = games.filter((g) => g.res.r === "L").length;
      const t = games.filter((g) => g.res.r === "T").length;
      $("statsTitle").textContent = "Our event";
      $("sRank").textContent = r ? "#" + r.stats.rank : "-";
      $("sRecord").textContent = games.length ? `${w}-${l}-${t}` : "-";
      $("sOpr").textContent = opr(src().team) != null && r ? opr(src().team).toFixed(1) : "-";
      $("sAvg").textContent = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0) : "-";
      $("sBest").textContent = scores.length ? Math.max(...scores) : "-";
    }
    drawSpark(games);
  }

  function drawSpark(games) {
    const svg = $("spark");
    if (games.length < 1) { svg.innerHTML = `<text x="150" y="40" text-anchor="middle" fill="#8c8a85" font-size="13">Scores appear after our first match</text>`; return; }
    const W = 300, H = 70, P = 6;
    const max = Math.max(...games.map((g) => Math.max(g.res.us, g.res.them)), 1);
    const x = (i) => games.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (games.length - 1);
    const y = (v) => H - P - (v / max) * (H - 2 * P);
    const line = (k) => games.map((g, i) => `${x(i)},${y(g.res[k])}`).join(" ");
    const dots = games.map((g, i) =>
      `<circle cx="${x(i)}" cy="${y(g.res.us)}" r="3.5" fill="${g.res.r === "W" ? "#52c77a" : g.res.r === "L" ? "#f0524f" : "#f2b134"}"/>`).join("");
    svg.innerHTML =
      `<polyline points="${line("them")}" fill="none" stroke="#8c8a85" stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>` +
      `<polyline points="${line("us")}" fill="none" stroke="#f2b134" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` + dots;
  }

  function renderSchedule() {
    const list = $("schedule");
    const ours = ourMatches();
    if (!ours.length) {
      list.innerHTML = `<li class="empty">${src().event ? "Our matches show here once the schedule is posted." : "No event selected."}</li>`;
      return;
    }
    const nm = nextMatch();
    list.innerHTML = ours.map((m) => {
      const a = allianceOf(m);
      const res = played(m) ? result(m, a) : null;
      const partners = m.teams.filter((t) => t.alliance === a && t.teamNumber !== src().team).map((t) => t.teamNumber).join(", ");
      const right = res ? `<span class="res ${res.r}">${res.r} ${res.us}-${res.them}</span>` : `<span class="when">${fmtTime(m.scheduledStartTime)}</span>`;
      return `<li class="${m === nm ? "next-up" : ""}"><i class="swatch ${a.toLowerCase()}" title="${a}"></i><span class="ml">${label(m)}</span><span class="with">with ${partners || "-"}</span>${right}</li>`;
    }).join("");
    const cur = list.querySelector(".next-up");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  let rankPage = 0;
  function renderRankings() {
    const tbl = $("rankings");
    if (state.ranks.length) {
      $("rankTitle").textContent = "Rankings";
      tbl.innerHTML = `<thead><tr><th>#</th><th>Team</th><th>W-L-T</th><th>RP</th><th>OPR</th></tr></thead><tbody>` +
        state.ranks.map((t) => {
          const s = t.stats;
          return `<tr class="${t.teamNumber === src().team ? "us" : ""}"><td class="n">${s.rank}</td>` +
            `<td><span class="n">${t.teamNumber}</span> <span class="nm">${esc(teamName(t.teamNumber))}</span></td>` +
            `<td>${s.wins}-${s.losses}-${s.ties}</td><td>${s.rp.toFixed(1)}</td>` +
            `<td class="n">${s.opr ? s.opr.totalPointsNp.toFixed(0) : "-"}</td></tr>`;
        }).join("") + "</tbody>";
    } else if (state.roster.length) {
      // Scouting board: every registered team, by best OPR this season
      $("rankTitle").textContent = "Scouting · best OPR this season";
      const rows = state.roster.map((n) => ({ n, b: state.scout[n] && state.scout[n].best }))
        .sort((a, b) => (b.b ? b.b.opr : -1) - (a.b ? a.b.opr : -1));
      tbl.innerHTML = `<thead><tr><th>#</th><th>Team</th><th>Best rank</th><th>W-L-T</th><th>OPR</th></tr></thead><tbody>` +
        rows.map((r, i) => `<tr class="${r.n === src().team ? "us" : ""}"><td class="n">${i + 1}</td>` +
          `<td><span class="n">${r.n}</span> <span class="nm">${esc(teamName(r.n))}</span></td>` +
          `<td>${r.b ? "#" + r.b.rank : "new"}</td><td>${r.b ? `${r.b.w}-${r.b.l}-${r.b.t}` : "-"}</td>` +
          `<td class="n">${r.b ? r.b.opr.toFixed(0) : "-"}</td></tr>`).join("") + "</tbody>";
    } else {
      $("rankTitle").textContent = "Rankings";
      tbl.innerHTML = `<tr><td class="empty">Rankings appear once matches start.</td></tr>`;
      return;
    }
    scrollRankings(true);
  }

  // Page through the table when it doesn't fit
  function scrollRankings(reset) {
    const wrap = document.querySelector(".rank-wrap");
    const tbl = $("rankings");
    const rows = tbl.querySelectorAll("tbody tr");
    if (!rows.length || !wrap.clientHeight) return;
    rows.forEach((r) => { r.style.display = ""; });
    const rowH = rows[0].offsetHeight || 28;
    const head = tbl.querySelector("thead") ? tbl.querySelector("thead").offsetHeight : 0;
    const perPage = Math.max(1, Math.floor((wrap.clientHeight - head) / rowH));
    const pages = Math.ceil(rows.length / perPage);
    if (reset) {
      // Start on the page that has us
      const usIdx = [...rows].findIndex((r) => r.classList.contains("us"));
      rankPage = usIdx >= 0 ? Math.floor(usIdx / perPage) : Math.min(rankPage, pages - 1);
    } else rankPage = (rankPage + 1) % pages;
    rows.forEach((r, i) => { r.style.display = Math.floor(i / perPage) === rankPage ? "" : "none"; });
  }

  // ---------- judge slides ----------
  const slides = base.slides && base.slides.length ? base.slides : [{ title: "Add slides in config.js", bullets: [] }];
  let slideIdx = 0;
  function renderSlide() {
    const s = slides[slideIdx];
    const team = src().team;
    $("slide").innerHTML = `<div class="kicker">${team || ""} ${esc(teamName(team))}</div><h1>${esc(s.title)}</h1>` +
      `<ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` +
      (s.image ? `<img src="${esc(s.image)}" alt="${esc(s.title)}">` : "");
    $("slide").style.animation = "none";
    void $("slide").offsetWidth;
    $("slide").style.animation = "";
    $("slideDots").innerHTML = slides.map((_, i) => `<i class="${i === slideIdx ? "on" : ""}"></i>`).join("");
  }
  function stepSlide(d) { slideIdx = (slideIdx + d + slides.length) % slides.length; renderSlide(); }
  function robot(on) {
    const r = window.Robot3D;
    if (r) on ? r.start() : r.stop();
    else if (on) window.addEventListener("robot3d-ready", () => view === "judge" && window.Robot3D.start(), { once: true });
  }

  // ---------- match timer ----------
  const T = cfg.timer;
  const total = T.auto + T.transition + T.teleop;
  const timer = { running: false, elapsed: 0, last: 0, teleOnly: false, phase: "" };
  let audio;
  function beep(freq = 880, dur = 0.25, times = 1) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = audio.createOscillator(), g = audio.createGain();
        const t0 = audio.currentTime + i * (dur + 0.08);
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.25, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g).connect(audio.destination);
        o.start(t0); o.stop(t0 + dur);
      }
    } catch {}
  }
  function timerState() {
    const start = timer.teleOnly ? T.auto + T.transition : 0;
    const e = start + timer.elapsed;
    if (e < T.auto) return { phase: "Auto", cls: "auto", left: T.auto - e, e };
    if (e < T.auto + T.transition) return { phase: "Pick up controllers", cls: "", left: T.auto + T.transition - e, e };
    if (e < total) {
      const left = total - e;
      return { phase: left <= T.endgame ? "Endgame" : "Teleop", cls: left <= T.endgame ? "endgame" : "teleop", left, e };
    }
    return { phase: "Match over", cls: "endgame", left: 0, e: total };
  }
  function renderTimer() {
    if (timer.running) {
      const t = performance.now();
      timer.elapsed += (t - timer.last) / 1000;
      timer.last = t;
    }
    const s = timerState();
    if (timer.running && s.phase !== timer.phase) {
      if (s.phase === "Pick up controllers") beep(660, 0.4);
      if (s.phase === "Teleop") beep(880, 0.2, 3);
      if (s.phase === "Endgame") beep(1200, 0.3, 2);
      if (s.phase === "Match over") { beep(440, 0.8); timer.running = false; }
    }
    timer.phase = s.phase;
    const left = Math.ceil(s.left);
    $("timerTime").textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    $("timerPhase").textContent = timer.running || timer.elapsed ? s.phase : "Ready" + (timer.teleOnly ? " · teleop only" : "");
    $("timerPhase").className = "timer-phase " + s.cls;
    $("timerFill").style.width = (100 * s.e / total).toFixed(2) + "%";
  }
  function timerToggle() {
    if (timerState().phase === "Match over") timerReset();
    timer.running = !timer.running;
    timer.last = performance.now();
    if (timer.running && timer.elapsed === 0) beep(1000, 0.5);
    renderTimer();
  }
  function timerReset() { timer.running = false; timer.elapsed = 0; timer.phase = ""; renderTimer(); }

  // ---------- checklist ----------
  const items = base.checklist || [];
  let checked = store.get("checked", []);
  function renderChecklist() {
    const done = items.filter((_, i) => checked.includes(i)).length;
    $("checkCount").textContent = `${done}/${items.length}` + (done === items.length && items.length ? " · ready to queue" : "");
    $("checklist").innerHTML = items.map((txt, i) =>
      `<li data-i="${i}" class="${checked.includes(i) ? "done" : ""}" role="checkbox" aria-checked="${checked.includes(i)}"><span class="box">${CHECK_SVG}</span>${esc(txt)}<kbd class="k">${String.fromCharCode(65 + i)}</kbd></li>`).join("");
  }
  function toggleItem(i) {
    if (i < 0 || i >= items.length) return;
    checked = checked.includes(i) ? checked.filter((x) => x !== i) : [...checked, i];
    store.set("checked", checked);
    renderChecklist();
  }
  $("checklist").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) toggleItem(Number(li.dataset.i));
  });
  $("checkReset").addEventListener("click", () => { checked = []; store.set("checked", checked); renderChecklist(); });

  // ---------- settings ----------
  const form = $("settingsForm");
  function fillSettings() {
    form.team.value = cfg.team || "";
    form.event.value = cfg.event || "";
    form.season.value = cfg.season;
    form.demo.checked = !!cfg.demo;
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const next = {
      team: Number(form.team.value) || null,
      event: form.event.value.trim().toUpperCase() || null,
      season: Number(form.season.value) || 2026,
      demo: form.demo.checked,
    };
    store.set("settings", next);
    Object.assign(cfg, next);
    clockOffset = 0;
    state.event = null; state.matches = []; state.ranks = []; state.roster = [];
    show("dash");
    load();
  });
  $("findEvents").addEventListener("click", async () => {
    const team = Number(form.team.value);
    const season = Number(form.season.value) || 2026;
    const list = $("eventList");
    if (!team) { list.innerHTML = "<li>Enter a team number first</li>"; return; }
    list.innerHTML = "<li>Searching…</li>";
    try {
      const evs = await api(`/teams/${team}/events/${season}`);
      if (!evs.length) { list.innerHTML = `<li>No ${season} events found for ${team} yet</li>`; return; }
      const details = await Promise.all(evs.map((e) => api(`/events/${season}/${e.eventCode}`).catch(() => ({ code: e.eventCode }))));
      list.innerHTML = details.map((d) =>
        `<li data-code="${esc(d.code)}"><b>${esc(d.code)}</b> ${esc(d.name || "")} <span>${esc(d.start || "")}</span></li>`).join("");
    } catch { list.innerHTML = "<li>Couldn't reach FTCScout. Check the Wi-Fi.</li>"; }
  });
  $("eventList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-code]");
    if (!li) return;
    form.event.value = li.dataset.code;
    form.demo.checked = false;
  });

  // ---------- views + keys ----------
  let view = "dash";
  function show(v) {
    view = v;
    document.body.dataset.view = v;
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    robot(v === "judge");
    if (v === "judge") renderSlide();
    if (v === "timer") renderTimer();
    if (v === "check") renderChecklist();
    if (v === "settings") fillSettings();
    if (v === "dash") renderAll();
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) show(b.dataset.view);
  });

  document.addEventListener("keydown", (e) => {
    poke();
    if (e.target.tagName === "INPUT") { if (e.key === "Escape") { e.target.blur(); show("dash"); } return; }
    const k = e.key.toLowerCase();
    if (k >= "1" && k <= "4") return show(VIEWS[Number(k) - 1]);
    if (k === "s" && view !== "check") return show("settings");
    if (k === "escape") return show("dash");
    if (view === "judge" && (k === "arrowright" || k === " ")) { e.preventDefault(); stepSlide(1); }
    if (view === "judge" && k === "arrowleft") stepSlide(-1);
    if (view === "timer") {
      if (k === " ") { e.preventDefault(); timerToggle(); }
      if (k === "r") timerReset();
      if (k === "t") { timer.teleOnly = !timer.teleOnly; timerReset(); }
    }
    if (view === "check") {
      if (k === "backspace") $("checkReset").click();
      else if (/^[a-z]$/.test(k)) toggleItem(k.charCodeAt(0) - 97);
    }
    if (view === "dash" && k === "r") load();
    if (k === "f" && view !== "check") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
  });

  // Hide the mouse and dim the dock when nobody's touching it
  let lastInput = Date.now();
  function poke() {
    lastInput = Date.now();
    document.body.classList.remove("hide-cursor", "idle");
  }
  document.addEventListener("mousemove", poke);
  document.addEventListener("mousedown", poke);

  // ---------- loops ----------
  let lastNext = null;
  setInterval(() => {
    const d = new Date(now());
    $("clock").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz() });
    tickStatus();
    if (view === "dash") tickCountdown();
    if (cfg.demo && view === "dash" && nextMatch() !== lastNext) { lastNext = nextMatch(); renderAll(); }
    const idle = Date.now() - lastInput;
    if (idle > 3000) document.body.classList.add("hide-cursor");
    if (idle > 15000) document.body.classList.add("idle");
    if (cfg.judgeIdleMinutes > 0 && idle > cfg.judgeIdleMinutes * 60000 && view === "dash") show("judge");
  }, 1000);

  setInterval(() => { if (view === "timer") renderTimer(); }, 100);
  setInterval(() => { if (view === "judge") stepSlide(1); }, 10000);
  setInterval(() => { if (view === "dash") scrollRankings(false); }, 7000);
  setInterval(load, Math.max(30, cfg.refreshSeconds || 60) * 1000);

  show(url.get("view") && VIEWS.includes(url.get("view")) ? url.get("view") : "dash");
  load();
})();
