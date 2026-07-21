/* TPIPS interactive teaser.
 *
 * A single comparison table (not a sliding carousel of separate tables). One
 * reference image is compared against N candidates, labelled A/B/C/... Every
 * prior unconditional method (L2, SSIM, LPIPS, DreamSim) and every TPIPS aspect
 * is a ROW on the left; the group name ("Prior methods" / "Ours TPIPS") sits in
 * a further-left column. A checkmark in each row marks the candidate that row
 * picks, placed in that candidate's column (i.e. beneath the selected image).
 *
 * Interaction is HOVER-based: hovering a method / aspect name drives a thin
 * vertical gauge beside each candidate image to that row's per-candidate score
 * (the closest candidate's gauge, score and image border go solid blue; the
 * rest are a faded blue). Moving between examples keeps the method rows in place
 * -- only the images swap (crossfade) and the checkmarks slide to their new
 * winning columns.
 *
 * Data layout:
 *   data/teaser/examples.json -> {
 *     examples: [{
 *       id, title, reference, reference_label, aspects: [...],
 *       candidates: [{
 *         id, img,
 *         scores: { aspect: tpipsScore },
 *         baseline_scores: { l2, ssim, lpips, dreamsim }
 *       }]
 *     }]
 *   }
 */

(function () {
  "use strict";

  const ROOT_DIR = "data/teaser";

  // Prior methods are unconditional (one score per candidate, no aspect).
  // Direction: 'lower' means smaller raw value = more similar.
  const BASELINE_METHODS = [
    { key: "lpips", label: "LPIPS", direction: "lower" },
    { key: "dreamsim", label: "DreamSim", direction: "lower" },
    { key: "ssim", label: "SSIM", direction: "higher" },
    { key: "l2", label: "L2", direction: "lower" },
  ];

  // Per-aspect accent colours (still used by the phone layout's pills/bars).
  const ASPECT_PALETTE = [
    { solid: "#2563eb", tint: "rgba(37, 99, 235, 0.12)" },   // blue
    { solid: "#e07d0c", tint: "rgba(224, 125, 12, 0.14)" },  // orange
    { solid: "#2f9e2a", tint: "rgba(47, 158, 42, 0.14)" },   // green
    { solid: "#0e9bb8", tint: "rgba(14, 155, 184, 0.14)" },  // cyan
    { solid: "#8b5cf6", tint: "rgba(139, 92, 246, 0.14)" },  // violet
  ];
  const PRIOR_COLOR = { solid: "#8a9099", text: "#565b62", tint: "#eef0f2", border: "#d5d9de" };

  // #rrggbb -> rgba() at the given alpha (for faded bars/scores)
  function fade(hex, a) {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
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

  function fetchJSON(url) {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
      return r.json();
    });
  }

  /* Lightbox: single shared overlay, lazily built, for zooming any teaser image. */
  let lightbox = null;
  function ensureLightbox() {
    if (lightbox) return lightbox;
    const img = els("img", { class: "lightbox-img", alt: "" });
    const closeBtn = els("button", { class: "lightbox-close", type: "button",
                                      "aria-label": "Close", html: "&times;" });
    const overlay = els("div", { class: "lightbox-overlay" }, [img, closeBtn]);
    const close = () => overlay.classList.remove("is-open");
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    document.body.appendChild(overlay);
    lightbox = { overlay, img };
    return lightbox;
  }

  function makeZoomable(img) {
    img.classList.add("zoomable");
    img.addEventListener("click", () => {
      const lb = ensureLightbox();
      lb.img.src = img.src;
      lb.img.alt = img.alt;
      lb.overlay.classList.add("is-open");
    });
  }

  const CAND_LABELS = "ABCDEFGH";

  function render(data, root) {
    const examples = data.examples || [];
    if (!examples.length) {
      root.innerHTML = `<div class="teaser-empty">No teaser examples.</div>`;
      return;
    }

    /* Fixed bar ranges: similarity metrics (higher-is-better) share [0,1];
     * each distance metric gets its own data-spanning range so its values don't
     * squash against zero. */
    const distKeys = BASELINE_METHODS.filter(m => m.direction === "lower").map(m => m.key);
    const ranges = { similarity: { lo: 0, hi: 1 } };
    distKeys.forEach(k => {
      let min = Infinity, max = -Infinity;
      examples.forEach(e => (e.candidates || []).forEach(c => {
        const v = c.baseline_scores[k];
        if (v < min) min = v;
        if (v > max) max = v;
      }));
      ranges[k] = { lo: min * 0.95, hi: max * 1.05 };
    });

    const baselineItems = BASELINE_METHODS.map(m => ({
      group: "baseline", key: m.key, label: m.label, direction: m.direction,
    }));
    const aspectItemsFor = ex => (ex.aspects || []).map((a, j) => ({
      group: "aspect", key: a, label: a, direction: "higher",
      color: ASPECT_PALETTE[j % ASPECT_PALETTE.length],
    }));
    const colorOf = item => item.group === "aspect" ? item.color : PRIOR_COLOR;

    const CAND_N = (examples[0].candidates || []).length;
    const maxAspects = examples.reduce((m, e) => Math.max(m, (e.aspects || []).length), 0);
    const labelOf = i => CAND_LABELS[i] || String(i + 1);

    const scoreFor = (cand, item) =>
      item.group === "baseline" ? cand.baseline_scores[item.key] : cand.scores[item.key];
    const winnerIdxIn = (cands, item) => {
      const vals = cands.map(c => scoreFor(c, item));
      const best = item.direction === "lower" ? Math.min(...vals) : Math.max(...vals);
      return vals.indexOf(best);
    };
    const rangeFor = item => item.direction === "higher" ? ranges.similarity : ranges[item.key];

    /* ===================== state ===================== */
    let exIdx = 0;

    /* ===================== DESKTOP GRID (persistent) ===================== */
    const grid = els("div", { class: "teaser-grid" });
    const refCol = 1;
    const candCol = i => refCol + 1 + i;   // candidate i lives in this grid column
    const dirColNum = candCol(CAND_N - 1) + 1;   // direction-arrow column, far right
    // reference + candidates share equal columns; labels/names live in the
    // reference column so they left-align with the reference image.
    grid.style.gridTemplateColumns =
      `repeat(${1 + CAND_N}, minmax(0, 1fr)) auto`;

    const place = (el, gc, gr) => { el.style.gridColumn = String(gc); el.style.gridRow = String(gr); grid.appendChild(el); return el; };

    // row 1: reference label (over the reference column) + the question. The
    // question is built ONCE; hovering only swaps the attribute span (q-asp) so
    // the whole sentence isn't redrawn each time.
    const qEl = els("div", { class: "tgrid-question" });
    const qAsp = els("span", { class: "q-asp" });
    const qWrt = els("span", { class: "q-wrt" }, [document.createTextNode(" w.r.t. "), qAsp]);
    qWrt.style.display = "none";
    qEl.appendChild(document.createTextNode("Which is more similar to the reference"));
    qEl.appendChild(qWrt);
    qEl.appendChild(document.createTextNode("?"));
    place(els("div", { class: "tgrid-ref-label", text: "Reference image" }), refCol, 1);
    place(els("div", { class: "tgrid-title" }, [qEl, els("div", { class: "tgrid-bracket" })]),
      `${refCol + 1} / span ${CAND_N}`, 1);

    // far-right direction arrow (image-height, built on hover by setDir)
    const dirArrow = els("div", { class: "tgrid-dir" });
    place(dirArrow, dirColNum, 2);

    // row 2: reference image + candidate cells (image + a thin vertical gauge)
    const refImg = els("img", { alt: "reference image", loading: "lazy" });
    makeZoomable(refImg);
    const refFrame = els("div", { class: "ref-frame" }, [refImg]);
    place(refFrame, refCol, 2);

    // --bar-h: image height, used to size the direction arrow to match the images
    function updateReserve() {
      const h = refFrame.getBoundingClientRect().height;
      if (h > 0) grid.style.setProperty("--bar-h", `${h.toFixed(1)}px`);
    }

    const candImgs = [], candThumbs = [], gauges = [];
    for (let i = 0; i < CAND_N; i++) {
      const img = els("img", { alt: `candidate ${labelOf(i)}`, loading: "lazy" });
      makeZoomable(img);
      const thumb = els("div", { class: "cand-thumb" }, [img, els("div", { class: "cand-label", text: labelOf(i) })]);
      const fill = els("div", { class: "cand-gauge-fill" });
      const gauge = els("div", { class: "cand-gauge" }, [fill]);   // matches image height
      const val = els("div", { class: "cand-gauge-val" });          // score, centered below the bar
      const valWrap = els("div", { class: "cand-gauge-valwrap" }, [val]);
      const barRow = els("div", { class: "cand-barrow" }, [thumb, gauge]);
      place(els("div", { class: "cand-cell" }, [barRow, valWrap]), candCol(i), 2);
      candImgs.push(img); candThumbs.push(thumb); gauges.push({ fill, val });
    }

    /* method / aspect rows. Prior rows are fixed (same four every example);
     * aspect rows are reusable slots whose label text is swapped per example.
     * Each row owns a checkmark that moves to the winning candidate's column. */
    const rowSlots = [];
    let r = 3;

    function makeRow(group) {
      const nameEl = els("div", { class: "tgrid-name is-" + group });
      const tick = els("span", { class: "matrix-tick", html: "&#10003;" });
      if (group === "prior") tick.style.color = PRIOR_COLOR.text;   // gray, matches the tile
      const chk = els("div", { class: "sel-cell" }, [tick]);
      const slot = { group, nameEl, chk, tick, item: null };
      place(nameEl, 1, r);
      place(chk, candCol(0), r);   // real column set per example
      nameEl.addEventListener("mouseenter", () => { if (slot.item) applyItem(slot.item, true); });
      rowSlots.push(slot);
      r++;
      return slot;
    }

    // Prior-methods section: a header row labelling the methods underneath
    place(els("div", { class: "tgrid-head" }, [
      els("span", { text: "Prior methods" }),
      els("span", { class: "th-sub", text: " (unconditional similarity)" }),
    ]), "1 / -1", r); r++;
    baselineItems.forEach(m => { const s = makeRow("prior"); s.item = m; s.nameEl.textContent = m.label; });

    // Ours section: header row (extra top space where the divider used to be)
    place(els("div", { class: "tgrid-head is-tpips",
      text: "Our Text-Prompted Image Perceptual Similarity (TPIPS)" }), "1 / -1", r); r++;
    const aspectSlots = [];
    for (let k = 0; k < maxAspects; k++) aspectSlots.push(makeRow("aspect"));

    place(els("div", { class: "table-hint",
      text: "Hover a method or aspect on the left to see its per-candidate similarity; the closest image is highlighted in blue." }),
      "1 / -1", r); r++;

    /* ---- desktop behaviour ---- */
    // update ONLY the attribute span, and only when it actually changes (so
    // hovering between two prior methods doesn't redraw the "overall" word)
    let lastQAttrKey = null;
    function updateQuestionAttr(item) {
      const key = item.group === "aspect" ? "a:" + item.label : "overall";
      if (key === lastQAttrKey) return;
      lastQAttrKey = key;
      if (item.group === "aspect") {
        qAsp.textContent = item.label;
        qAsp.style.color = item.color.solid;
        qAsp.classList.remove("q-ov");
      } else {
        qAsp.textContent = "overall";
        qAsp.style.color = "";
        qAsp.classList.add("q-ov");
      }
      qWrt.style.display = "";
      qAsp.classList.remove("q-anim"); void qAsp.offsetWidth; qAsp.classList.add("q-anim");
    }

    // tall arrow (image height) coloured to match the method; "more similar"
    // sits above it for ↑ and below it for ↓. When the direction CHANGES the
    // shaft sweeps in (bottom-to-top for ↑, top-to-bottom for ↓) while the
    // caption slides from its old side to the new one; unchanged -> recolour.
    let lastDir = null;
    const capEl = els("div", { class: "tgrid-dir-cap", text: "more similar" });
    function setDir(item, solid) {
      const dir = item.direction !== "lower" ? "up" : "down";
      dirArrow.style.color = solid;
      dirArrow.classList.add("is-shown");
      if (dir === lastDir) return;
      lastDir = dir;
      const up = dir === "up";

      // caption's position before we re-order it (for the FLIP slide)
      const first = capEl.isConnected ? capEl.getBoundingClientRect() : null;

      dirArrow.textContent = "";
      const arrow = els("div", { class: "tgrid-dir-arrow sweep " + (up ? "is-up" : "is-down") });
      if (up) { dirArrow.appendChild(capEl); dirArrow.appendChild(arrow); }
      else { dirArrow.appendChild(arrow); dirArrow.appendChild(capEl); }

      if (first) {
        // slide the caption top<->bottom as the shaft draws in
        capEl.classList.remove("cap-in");
        const dy = first.top - capEl.getBoundingClientRect().top;
        capEl.style.transition = "none";
        capEl.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          capEl.style.transition = "transform 380ms cubic-bezier(0.22, 0.61, 0.36, 1)";
          capEl.style.transform = "";
        });
      } else {
        // first appearance: fade in after the sweep
        capEl.classList.remove("cap-in"); void capEl.offsetWidth; capEl.classList.add("cap-in");
      }
    }

    let activeItem = null;   // last hovered item (bars are emptied when de-selected)
    // selected=true  -> bars + scores shown, coloured to match the method;
    // selected=false -> nothing selected: empty bars (score 0), no score text.
    function applyItem(item, selected) {
      const cands = examples[exIdx].candidates || [];
      const bestIdx = winnerIdxIn(cands, item);
      const solid = item.group === "aspect" ? item.color.solid : PRIOR_COLOR.solid;
      // winner border matches the aspect colour, but a slightly darker gray for
      // prior methods so it reads clearly against the image.
      const border = item.group === "aspect" ? item.color.solid : "#63696f";
      const rng = rangeFor(item), denom = (rng.hi - rng.lo) || 1;
      cands.forEach((c, i) => {
        if (!selected) {
          gauges[i].fill.style.height = "0%";
          gauges[i].val.textContent = "";
          candThumbs[i].classList.remove("is-win");
          candThumbs[i].style.borderColor = "";
          return;
        }
        const v = scoreFor(c, item);
        const pct = Math.max(0, Math.min(100, ((v - rng.lo) / denom) * 100));
        const win = i === bestIdx;
        gauges[i].fill.style.height = `${pct.toFixed(1)}%`;
        gauges[i].fill.style.background = win ? solid : fade(solid, 0.34);
        gauges[i].val.textContent = v.toFixed(3);
        gauges[i].val.style.color = win ? solid : fade(solid, 0.6);
        candThumbs[i].classList.toggle("is-win", win);
        candThumbs[i].style.borderColor = win ? border : "";
      });
      rowSlots.forEach(s => {
        const on = selected && s.item === item;
        s.nameEl.classList.toggle("is-active", on);
        s.chk.classList.toggle("is-active", on);
      });
      if (selected) { updateQuestionAttr(item); setDir(item, solid); }
      else { qWrt.style.display = "none"; dirArrow.classList.remove("is-shown"); lastQAttrKey = null; }
      activeItem = item;
    }

    // leaving the table de-selects everything: bars empty out, no scores shown
    grid.addEventListener("mouseleave", () => { if (activeItem) applyItem(activeItem, false); });

    // FLIP: slide the checkmark from its old cell to the new winning column.
    function flipMove(el, apply) {
      const first = el.getBoundingClientRect();
      apply();
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left, dy = first.top - last.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 460ms cubic-bezier(0.22, 0.61, 0.36, 1)";
        el.style.transform = "";
      });
    }

    function setDesktopExample(ex, animate) {
      const cands = ex.candidates || [];
      const asp = aspectItemsFor(ex);

      const swap = (img, src) => {
        img.src = `${ROOT_DIR}/${src}`;
        if (animate) { img.classList.remove("img-swap"); void img.offsetWidth; img.classList.add("img-swap"); }
      };
      swap(refImg, ex.reference);
      candImgs.forEach((img, i) => swap(img, cands[i].img));

      // aspect rows: swap in this example's aspects (fade the labels), hide extras
      aspectSlots.forEach((s, k) => {
        const item = asp[k] || null;
        s.item = item;
        if (item) {
          s.nameEl.textContent = item.label;
          // coloured tile per aspect; the checkmark matches the tile colour
          s.nameEl.style.background = item.color.tint;
          s.nameEl.style.borderColor = item.color.solid;
          s.nameEl.style.color = item.color.solid;
          s.tick.style.color = item.color.solid;
          s.nameEl.classList.remove("is-hidden");
          s.chk.classList.remove("is-hidden");
          if (animate) { s.nameEl.classList.remove("name-fade"); void s.nameEl.offsetWidth; s.nameEl.classList.add("name-fade"); }
        } else {
          s.nameEl.classList.add("is-hidden");
          s.chk.classList.add("is-hidden");
        }
      });

      // move every checkmark to its winning column (sliding if animating)
      rowSlots.forEach(s => {
        if (!s.item) return;
        const wi = winnerIdxIn(cands, s.item);
        const move = () => { s.chk.style.gridColumn = String(candCol(wi)); };
        if (animate) flipMove(s.chk, move); else move();
      });

      // after a switch nothing is selected: show a default row's scores, grayed
      applyItem(asp[0] || baselineItems[0], false);
    }

    /* ===================== PHONE LAYOUT (transposed desktop) ===================== *
     * A vertical, tap-based rendering of the desktop table. The method / aspect
     * pills that sit down the LEFT of the desktop grid become a horizontally
     * SCROLLABLE row of buttons on TOP; the candidate images become a vertical
     * stack, each with a horizontal similarity bar RIGHT BELOW it. Tapping a
     * button fills every bar to that method's per-candidate score, ticks the
     * closest candidate and points a direction arrow at "more similar" (like the
     * desktop far-right arrow, but horizontal). Two tabs switch between the TPIPS
     * aspects and the prior methods. No zoom -- the winner is marked with a tick,
     * a coloured bar and a soft shadow instead. */
    const mobileWrap = els("div", { class: "teaser-mobile" });
    let mActiveTab = "tpips";      // which group's buttons are shown
    let mActiveKey = null;         // selected method / aspect key within the tab

    function mkThumb(src, alt, labelText) {
      const img = els("img", { src, alt, loading: "lazy" });
      makeZoomable(img);
      const t = els("div", { class: "tm-thumb" }, [img]);
      if (labelText) t.appendChild(els("div", { class: "cand-label", text: labelText }));
      return t;
    }

    function tabBar() {
      const bar = els("div", { class: "teaser-tabs" });
      const tpipsL1 = els("span", { class: "tm-tab-l1" });
      tpipsL1.appendChild(document.createTextNode("Ours: "));
      tpipsL1.appendChild(els("span", { class: "brand-tpips", text: "TPIPS" }));
      const tpipsBtn = els("button", { class: "tm-tab", type: "button" }, [
        tpipsL1,
        els("span", { class: "tm-tab-l2", text: "Text-Prompted Image Perceptual Similarity" }),
      ]);
      const priorBtn = els("button", { class: "tm-tab", type: "button" }, [
        els("span", { class: "tm-tab-l1", text: "Prior methods" }),
        els("span", { class: "tm-tab-l2", text: "Unconditional similarity" }),
      ]);
      tpipsBtn.classList.toggle("is-active", mActiveTab === "tpips");
      priorBtn.classList.toggle("is-active", mActiveTab === "prior");
      const switchTab = t => {
        if (mActiveTab === t) return;
        mActiveTab = t; mActiveKey = null;
        renderMobile(examples[exIdx]);
      };
      tpipsBtn.addEventListener("click", () => switchTab("tpips"));
      priorBtn.addEventListener("click", () => switchTab("prior"));
      bar.appendChild(tpipsBtn);
      bar.appendChild(priorBtn);
      return bar;
    }

    function renderMobile(ex) {
      const cands = ex.candidates || [];
      const items = mActiveTab === "tpips" ? aspectItemsFor(ex) : baselineItems;
      // keep the current selection if it still exists in this tab; else default
      // to the first button so the bars are populated on arrival.
      if (!items.some(it => it.key === mActiveKey)) mActiveKey = items.length ? items[0].key : null;

      mobileWrap.textContent = "";
      mobileWrap.appendChild(tabBar());

      // --- scrollable button row (was the left column of pills on desktop) ---
      const btnRow = els("div", { class: "tm-btnrow" });
      const btnEls = {};
      function scrollBtnIntoView(b) {
        const r = b.getBoundingClientRect(), pr = btnRow.getBoundingClientRect();
        if (r.left < pr.left || r.right > pr.right) b.scrollIntoView({ inline: "center", block: "nearest" });
      }
      items.forEach(it => {
        const c = colorOf(it), aspect = it.group === "aspect";
        const b = els("button", { class: "tm-btn", type: "button", text: it.label });
        b.style.background = c.tint;
        b.style.borderColor = aspect ? c.solid : c.border;
        b.style.color = aspect ? c.solid : c.text;
        b.addEventListener("click", () => { mActiveKey = it.key; applyMobile(); scrollBtnIntoView(b); });
        btnEls[it.key] = b;
        btnRow.appendChild(b);
      });
      mobileWrap.appendChild(btnRow);

      // --- question + direction arrow (rebuilt on each selection) ---
      const qEl = els("div", { class: "tm-question" });
      const dirEl = els("div", { class: "tm-dir" });
      mobileWrap.appendChild(qEl);
      mobileWrap.appendChild(dirEl);

      // --- candidate list: reference first (no bar), then one row per candidate,
      //     each = image with a horizontal similarity bar directly below it. ---
      const list = els("div", { class: "tm-list" });
      list.appendChild(els("div", { class: "tm-item is-ref" }, [
        mkThumb(`${ROOT_DIR}/${ex.reference}`, "reference image", null),
        els("div", { class: "tm-reflabel", text: ex.reference_label || "Reference image" }),
      ]));
      const rows = [];
      cands.forEach((cand, i) => {
        const thumb = mkThumb(`${ROOT_DIR}/${cand.img}`, `candidate ${labelOf(i)}`, labelOf(i));
        const fill = els("div", { class: "tm-fill" });
        const track = els("div", { class: "tm-track" }, [fill]);
        const score = els("div", { class: "tm-score" });
        const item = els("div", { class: "tm-item" }, [
          thumb, els("div", { class: "tm-barline" }, [track, score]),
        ]);
        list.appendChild(item);
        rows.push({ item, thumb, fill, score });
      });
      mobileWrap.appendChild(list);

      // fill bars + header for the currently-selected button
      function applyMobile() {
        const item = items.find(it => it.key === mActiveKey) || items[0];
        if (!item) return;
        for (const k in btnEls) btnEls[k].classList.toggle("is-active", k === item.key);

        const c = colorOf(item), aspect = item.group === "aspect";
        const solid = aspect ? c.solid : PRIOR_COLOR.solid;
        const border = aspect ? c.solid : "#63696f";
        const bestIdx = winnerIdxIn(cands, item);
        const rng = rangeFor(item), denom = (rng.hi - rng.lo) || 1;

        // question -- colour the attribute span to match the aspect
        qEl.textContent = "";
        qEl.appendChild(document.createTextNode("Which is more similar to the reference"));
        if (aspect) {
          qEl.appendChild(document.createTextNode(" w.r.t. "));
          const a = els("span", { class: "q-asp", text: item.label });
          a.style.color = solid;
          qEl.appendChild(a);
        }
        qEl.appendChild(document.createTextNode("?"));
        qEl.classList.remove("q-anim"); void qEl.offsetWidth; qEl.classList.add("q-anim");

        // direction arrow: higher-is-more-similar points right; distance points left
        const higher = item.direction !== "lower";
        dirEl.textContent = "";
        dirEl.style.color = solid;
        const cap = els("span", { class: "tm-dir-cap", text: "more similar" });
        const arrow = els("span", { class: "tm-dir-arrow " + (higher ? "is-right" : "is-left") });
        const note = els("span", { class: "tm-dir-note",
          text: higher ? "(longer bar = closer)" : "(shorter bar = closer)" });
        if (higher) { dirEl.appendChild(cap); dirEl.appendChild(arrow); }
        else { dirEl.appendChild(arrow); dirEl.appendChild(cap); }
        dirEl.appendChild(note);

        // bars + scores + winner tick
        rows.forEach((row, i) => {
          const v = scoreFor(cands[i], item);
          const pct = Math.max(0, Math.min(100, ((v - rng.lo) / denom) * 100));
          const win = i === bestIdx;
          row.fill.style.background = win ? solid : fade(solid, 0.34);
          row.score.textContent = "";
          if (win) {
            const t = els("span", { class: "tm-tick", html: "&#10003; " });
            t.style.color = solid;
            row.score.appendChild(t);
          }
          row.score.appendChild(document.createTextNode(v.toFixed(3)));
          row.score.style.color = win ? solid : "#8a9099";
          row.item.classList.toggle("is-win", win);
          row.thumb.style.borderColor = win ? border : "";
          // re-animate the width in from 0 whenever a button is tapped
          row.fill.style.width = "0%";
          requestAnimationFrame(() => requestAnimationFrame(() => {
            row.fill.style.width = `${pct.toFixed(1)}%`;
          }));
        });
      }

      applyMobile();
    }

    /* ===================== assembly + navigation ===================== */
    const exampleBox = els("div", { class: "teaser-example" }, [grid, mobileWrap]);

    const prev = els("button", { class: "ex-nav-btn is-prev", type: "button",
                                  "aria-label": "Previous example", html: "&#8249;" });
    const next = els("button", { class: "ex-nav-btn is-next", type: "button",
                                  "aria-label": "Next example", html: "&#8250;" });
    const dots = els("div", { class: "ex-dots" });
    const dotEls = examples.map((ex, i) => {
      const d = els("button", { class: "ex-dot", type: "button",
                                title: ex.title || `Example ${i + 1}`,
                                "aria-label": ex.title || `Example ${i + 1}` });
      d.addEventListener("click", () => setExample(i, true));
      dots.appendChild(d);
      return d;
    });
    const controls = els("div", { class: "teaser-controls" }, [prev, dots, next]);
    const card = els("div", { class: "teaser-card teaser-tpips" }, [controls, exampleBox]);
    root.appendChild(card);

    const setDots = () => dotEls.forEach((d, j) => d.classList.toggle("is-active", j === exIdx));

    function setExample(i, animate) {
      const n = examples.length;
      exIdx = ((i % n) + n) % n;
      const ex = examples[exIdx];
      setDesktopExample(ex, animate);
      renderMobile(ex);
      setDots();
    }

    prev.addEventListener("click", () => setExample(exIdx - 1, true));
    next.addEventListener("click", () => setExample(exIdx + 1, true));

    // desktop vs phone toggle (existing CSS keys off .teaser-example.is-mobile)
    const mq = window.matchMedia("(max-width: 640px)");
    const applyMode = () => exampleBox.classList.toggle("is-mobile", mq.matches);
    mq.addEventListener("change", applyMode);
    applyMode();

    setExample(0, false);
    // reserve the image-row height once laid out, and keep it in sync on resize
    requestAnimationFrame(updateReserve);
    if (refImg.complete) updateReserve(); else refImg.addEventListener("load", updateReserve);
    window.addEventListener("resize", updateReserve);
  }

  async function main() {
    const root = document.getElementById("teaser-root");
    if (!root) return;
    try {
      const data = await fetchJSON(`${ROOT_DIR}/examples.json`);
      root.innerHTML = "";
      render(data, root);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="teaser-empty">Failed to load teaser: ${err.message}</div>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
