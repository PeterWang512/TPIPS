/* TPIPS static video-similarity demo.
 *
 * Prestored data, served as static JSON (see scripts/precompute_video_demo.py
 * in tpips_dev):
 *   data/video_demo/manifest.json                          (video list + factors + ref-frame grid)
 *   data/video_demo/<video_id>/frames/<frame_idx>.jpg       (every frame, as a thumbnail)
 *   data/video_demo/<video_id>/scores/<factor_slug>_<ref>.json  (one per (factor, ref frame) state)
 *
 * UI (mirrors teaser.js's carousel + the interactive demo_video.py's dual-frame view):
 *   - left/right arrow + dot carousel to move between demo videos (one "example" per video)
 *   - two frame views per example: a draggable "reference frame" (snapped to the precomputed
 *     grid) and a draggable "comparison frame" (any frame) -- matching demo_video.py's
 *     reference-frame slider + frame slider
 *   - factor chips are multi-select (not radio): click to toggle a factor's curve on/off,
 *     each factor gets a persistent color (same palette as demo_video.html) so multiple
 *     curves are visible at once
 *   - chart: one polyline per selected factor, a solid blue vertical line + dot at the
 *     reference frame, a dashed grey vertical line at the comparison frame
 */

(function () {
  "use strict";

  const ROOT_DIR = "data/video_demo";

  const CHART_COLORS = [
    "#60a5fa", "#d62728", "#34d399", "#fbbf24", "#a78bfa",
    "#fb923c", "#2dd4bf", "#e879f9", "#a3e635", "#f472b6",
  ];

  function fetchJSON(url) {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
      return r.json();
    });
  }

  const els = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) if (c) e.appendChild(c);
    return e;
  };

  const PLAY_ICON = '<i class="fas fa-play"></i>';
  const PAUSE_ICON = '<i class="fas fa-pause"></i>';

  // Frame-image cache: keep decoded <img> objects alive so dragging the slider
  // (or auto-play) re-shows an already-loaded frame instantly instead of
  // re-fetching + re-decoding from the network on every input event.
  const frameImgCache = new Map(); // url -> HTMLImageElement

  function prefetchFrame(url) {
    let img = frameImgCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      frameImgCache.set(url, img);
    }
    return img;
  }

  const scoreCache = new Map(); // "videoId/slug/ref" -> {ref, scores}

  async function loadScores(videoId, slug, ref) {
    const key = `${videoId}/${slug}/${ref}`;
    if (scoreCache.has(key)) return scoreCache.get(key);
    const json = await fetchJSON(`${ROOT_DIR}/${videoId}/scores/${slug}_${ref}.json`);
    scoreCache.set(key, json);
    return json;
  }

  function frameUrl(vid, frameIdx) {
    return `${ROOT_DIR}/${vid.frames_dir}/${frameIdx}.jpg`;
  }

  /* ---------- chart ---------- */

  function drawChart(canvas, curves, refFrame, otherFrame, nFrames) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 180;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 34, padR = 8, padT = 10, padB = 20;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const n = nFrames;
    if (n <= 1 || plotW <= 0 || plotH <= 0) return;

    let lo = Infinity, hi = -Infinity;
    curves.forEach(c => {
      c.scores.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; });
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { hi += 0.05; lo -= 0.05; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;

    const xOf = i => padL + (i / (n - 1)) * plotW;
    const yOf = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    // axes
    ctx.strokeStyle = "#e2e2e2";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "#999";
    ctx.font = "10px 'Google Sans', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(hi.toFixed(2), padL - 5, padT + 4);
    ctx.fillText(lo.toFixed(2), padL - 5, padT + plotH);
    ctx.textAlign = "center";
    ctx.fillText("frame 0", xOf(0), cssH - 5);
    ctx.fillText(`frame ${n - 1}`, xOf(n - 1), cssH - 5);

    // comparison-frame marker (dashed grey), drawn under the curves
    if (otherFrame != null) {
      const x = xOf(Math.max(0, Math.min(n - 1, otherFrame)));
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // reference-frame marker (solid blue)
    if (refFrame != null) {
      const x = xOf(Math.max(0, Math.min(n - 1, refFrame)));
      ctx.strokeStyle = "#1f77b4";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }

    // similarity curves
    curves.forEach(c => {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i), y = yOf(c.scores[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // blue dot where this curve crosses the reference frame (always ~1.0)
      if (refFrame != null && refFrame < n) {
        ctx.fillStyle = "#1f77b4";
        ctx.beginPath();
        ctx.arc(xOf(refFrame), yOf(c.scores[refFrame]), 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  /* ---------- example pane (one per video) ---------- */

  function buildExample(vid) {
    const box = els("div", { class: "teaser-example video-demo-example" });
    box.appendChild(els("h4", { class: "video-demo-title", text: vid.label }));

    const factorColor = {};
    vid.factors.forEach((f, i) => { factorColor[f.slug] = CHART_COLORS[i % CHART_COLORS.length]; });

    let refIdx = 0;                                  // index into vid.ref_frames
    let otherFrame = 0;                               // raw frame index, freely draggable
    const selected = new Set([vid.factors[0].slug]);  // multi-select factor slugs
    let curves = [];                                  // last-drawn curves, cached for cheap redraws

    /* dual frame view */
    const refImg = els("img", { class: "video-demo-frame-img", alt: "reference frame" });
    const otherImg = els("img", { class: "video-demo-frame-img", alt: "comparison frame" });
    const refLabel = els("span", { class: "video-demo-frame-label" });
    const otherLabel = els("span", { class: "video-demo-frame-label" });

    const refSlider = els("input", {
      type: "range", min: "0", max: String(vid.ref_frames.length - 1), step: "1", value: "0",
    });
    const otherSlider = els("input", {
      type: "range", min: "0", max: String(vid.n_frames - 1), step: "1", value: "0",
    });

    // play/pause button that animates the comparison frame through the clip, as
    // if the slider were dragged naturally.
    const playBtn = els("button", {
      class: "video-demo-play-btn", type: "button", "aria-label": "Play", html: PLAY_ICON,
    });
    const otherCtlRow = els("div", { class: "video-demo-play-row" }, [playBtn, otherSlider]);

    const framesRow = els("div", { class: "video-demo-frames-row" }, [
      els("div", { class: "video-demo-frame-box" }, [
        els("div", { class: "nn-section-title", text: "Comparison frame" }),
        otherImg, otherCtlRow, otherLabel,
      ]),
      els("div", { class: "video-demo-frame-box" }, [
        els("div", { class: "nn-section-title", text: "Reference frame" }),
        refImg, refSlider, refLabel,
      ]),
    ]);
    box.appendChild(framesRow);

    // background-prefetch every frame of this video once, so scrubbing/playback
    // is lag-free. Fired lazily (on first refresh) to avoid loading all videos.
    let prefetched = false;
    function prefetchAllFrames() {
      if (prefetched) return;
      prefetched = true;
      for (let i = 0; i < vid.n_frames; i++) prefetchFrame(frameUrl(vid, i));
    }

    /* factor chips (multi-select) */
    box.appendChild(els("div", { class: "nn-section-title", text: "Visual aspects (click to toggle)" }));
    const chipsRow = els("div", { class: "teaser-toggle" });
    const chipEls = {};
    vid.factors.forEach(f => {
      const dot = els("span", { class: "video-demo-chip-dot" });
      dot.style.background = factorColor[f.slug];
      const chip = els("button", { class: "aspect-btn video-demo-chip", type: "button" }, [
        dot, document.createTextNode(f.name),
      ]);
      chip.addEventListener("click", () => {
        if (selected.has(f.slug)) {
          if (selected.size === 1) return; // keep at least one curve visible
          selected.delete(f.slug);
        } else {
          selected.add(f.slug);
        }
        refreshChart();
      });
      chipEls[f.slug] = chip;
      chipsRow.appendChild(chip);
    });
    box.appendChild(chipsRow);

    /* chart */
    const chartWrap = els("div", { class: "video-demo-chart-wrap" });
    const canvas = els("canvas", { class: "video-demo-canvas" });
    chartWrap.appendChild(canvas);
    box.appendChild(chartWrap);
    box.appendChild(els("div", {
      class: "video-demo-legend",
      html: '<span class="dot dot-ref"></span> reference frame &nbsp; ' +
            '<span class="dot dot-other"></span> comparison frame &nbsp; ' +
            "colored dots on chips = each aspect's curve color",
    }));

    function updateChipStyles() {
      vid.factors.forEach(f => {
        chipEls[f.slug].classList.toggle("is-active", selected.has(f.slug));
        chipEls[f.slug].style.borderColor = selected.has(f.slug) ? factorColor[f.slug] : "";
        chipEls[f.slug].style.color = selected.has(f.slug) ? factorColor[f.slug] : "";
      });
    }

    function updateFrameViews() {
      const refFrame = vid.ref_frames[refIdx];
      refImg.src = prefetchFrame(frameUrl(vid, refFrame)).src;
      refLabel.textContent = `${(refFrame / vid.fps).toFixed(2)} s (frame ${refFrame})`;
      otherImg.src = prefetchFrame(frameUrl(vid, otherFrame)).src;
      otherLabel.textContent = `${(otherFrame / vid.fps).toFixed(2)} s (frame ${otherFrame})`;
    }

    /* ---------- comparison-frame playback ---------- */
    let playing = false;
    let rafId = null;
    let lastT = 0;

    function stopPlay() {
      playing = false;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      playBtn.innerHTML = PLAY_ICON;
      playBtn.setAttribute("aria-label", "Play");
    }

    function startPlay() {
      if (playing) return;
      // restart from the beginning if we're already at (or past) the last frame
      if (otherFrame >= vid.n_frames - 1) {
        otherFrame = 0;
        otherSlider.value = "0";
        updateFrameViews();
        redrawMarkerOnly();
      }
      playing = true;
      playBtn.innerHTML = PAUSE_ICON;
      playBtn.setAttribute("aria-label", "Pause");
      lastT = performance.now();
      const PLAY_RATE = 1.5;   // play back at 1.5x speed
      const step = (t) => {
        if (!playing) return;
        const advance = Math.floor(((t - lastT) / 1000) * vid.fps * PLAY_RATE);
        if (advance >= 1) {
          otherFrame = Math.min(vid.n_frames - 1, otherFrame + advance);
          lastT = t;
          otherSlider.value = String(otherFrame);
          updateFrameViews();
          redrawMarkerOnly();
          if (otherFrame >= vid.n_frames - 1) { stopPlay(); return; }
        }
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }

    playBtn.addEventListener("click", () => { playing ? stopPlay() : startPlay(); });

    async function refreshChart() {
      prefetchAllFrames();
      updateChipStyles();
      const refFrame = vid.ref_frames[refIdx];
      const slugs = vid.factors.filter(f => selected.has(f.slug)); // keep manifest order
      const loaded = await Promise.all(slugs.map(f => loadScores(vid.id, f.slug, refFrame)));
      curves = slugs.map((f, i) => ({ slug: f.slug, color: factorColor[f.slug], scores: loaded[i].scores }));
      drawChart(canvas, curves, refFrame, otherFrame, vid.n_frames);
    }

    function redrawMarkerOnly() {
      const refFrame = vid.ref_frames[refIdx];
      drawChart(canvas, curves, refFrame, otherFrame, vid.n_frames);
    }

    refSlider.addEventListener("input", () => {
      refIdx = parseInt(refSlider.value, 10);
      updateFrameViews();
      refreshChart();
    });
    otherSlider.addEventListener("input", () => {
      stopPlay(); // manual scrub takes over from auto-play
      otherFrame = parseInt(otherSlider.value, 10);
      updateFrameViews();
      redrawMarkerOnly();
    });
    window.addEventListener("resize", redrawMarkerOnly);

    updateFrameViews();
    return { box, refresh: () => refreshChart(), stop: stopPlay };
  }

  /* ---------- carousel (mirrors teaser.js) ---------- */

  function render(manifest, root) {
    const videos = manifest.videos || [];
    if (!videos.length) {
      root.innerHTML = `<div class="nn-empty">No demo videos configured.</div>`;
      return;
    }

    const built = videos.map(buildExample);
    const n = built.length;

    // A single stage holds the active video. Switching videos swaps the pane in
    // place and rotates only the frame images on top in; everything common
    // (titles, sliders, chips, chart) stays put.
    const stage = els("div", { class: "video-demo-stage" });
    const viewport = els("div", { class: "teaser-viewport" }, [stage]);
    const carousel = els("div", { class: "teaser-carousel" }, [viewport]);

    const prev = els("button", { class: "ex-nav-btn is-prev", type: "button",
                                  "aria-label": "Previous video", html: "&#8249;" });
    const next = els("button", { class: "ex-nav-btn is-next", type: "button",
                                  "aria-label": "Next video", html: "&#8250;" });

    const dots = els("div", { class: "ex-dots" });
    const dotEls = videos.map((v, i) => {
      const d = els("button", { class: "ex-dot", type: "button", title: v.label,
                                "aria-label": v.label });
      d.addEventListener("click", () => goto(i));
      dots.appendChild(d);
      return d;
    });

    // navigation bar (arrows flank the dots) on top of the card, matching teaser
    const controls = els("div", { class: "teaser-controls" }, [prev, dots, next]);
    const card = els("div", { class: "teaser-card" }, [controls, carousel]);
    root.appendChild(card);

    let idx = -1;
    const setDots = () => dotEls.forEach((d, i) => d.classList.toggle("is-active", i === idx));
    const setNav = () => { prev.disabled = idx === 0; next.disabled = idx === n - 1; };

    function goto(i) {
      i = Math.max(0, Math.min(n - 1, i));
      if (i === idx) return;
      built.forEach(b => b.stop && b.stop()); // halt playback on the outgoing video
      idx = i;
      const b = built[idx];
      stage.textContent = "";
      stage.appendChild(b.box);
      b.refresh();
      // rotate only the top frame videos in
      b.box.classList.remove("is-switching");
      void b.box.offsetWidth;
      b.box.classList.add("is-switching");
      setDots();
      setNav();
    }

    prev.addEventListener("click", () => goto(idx - 1));
    next.addEventListener("click", () => goto(idx + 1));

    goto(0);
  }

  /* ---------- main ---------- */

  async function main() {
    const root = document.getElementById("video-demo-root");
    if (!root) return;

    let manifest;
    try {
      manifest = await fetchJSON(`${ROOT_DIR}/manifest.json`);
    } catch (e) {
      root.innerHTML = `<div class="nn-empty">No video-demo data yet.<br />
        Run <code>python scripts/precompute_video_demo.py</code> from tpips_dev
        to generate it.</div>`;
      return;
    }
    root.innerHTML = "";
    render(manifest, root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
