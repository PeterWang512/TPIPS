/* Aspect-Conditioned Retrieval section.
 *
 * One box per query photo. Left: the query image. Right: a stack of labeled
 * rows, each a horizontal strip of the top-K images retrieved from the
 * OpenImages bank under one condition:
 *   - "Overall similarity"  = TPIPS conditioned on the `overall` aspect.
 *   - each named aspect      = aspect_sim - 0.3 * overall_sim.
 * Left/right arrows (and dots) toggle between queries; clicking any image
 * opens a lightbox. Data is prestored by webvis/site/build_retrieval.py.
 */
(function () {
  "use strict";

  const ROOT_DIR = "data/retrieval";

  // Per-aspect accent colours (matches teaser.js). The overall-similarity row
  // uses the TPIPS brand blue — it's one of our conditions, not a baseline.
  const ASPECT_PALETTE = ["#2563eb", "#e07d0c", "#2f9e2a", "#0e9bb8", "#8b5cf6"];
  const OVERALL_COLOR = "#14508f";

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

  /* Lightbox: single shared overlay, lazily built. */
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

  // Build one query box (carousel slide). The query photo is repeated on the
  // left of every row so each aspect strip sits directly beside its query.
  function buildBox(q) {
    let aspectColor = 0;
    const rowsEls = q.rows.map(row => {
      const color = row.reference ? OVERALL_COLOR
                                  : ASPECT_PALETTE[(aspectColor++) % ASPECT_PALETTE.length];

      // per-row copy of the query image (caption above, so the image lines up
      // with the row label + retrieved strip)
      const qImg = els("img", { class: "retrieval-query-img", src: `${ROOT_DIR}/${q.query}`,
                                alt: `query ${q.id}`, loading: "lazy" });
      makeZoomable(qImg);
      const queryCell = els("div", { class: "retrieval-query" }, [
        els("div", { class: "retrieval-query-cap", text: "Query" }),
        qImg,
      ]);

      const label = els("div", { class: "retrieval-row-label", text: row.label });
      label.style.background = color;
      const strip = els("div", { class: "retrieval-strip" },
        row.results.map((src, j) => {
          const im = els("img", { class: "retrieval-result", src: `${ROOT_DIR}/${src}`,
                                  alt: row.label, loading: "lazy" });
          // stagger the fade-in left-to-right, after the query image shows
          im.style.animationDelay = `${(0.18 + j * 0.06).toFixed(2)}s`;
          makeZoomable(im);
          return im;
        }));
      const body = els("div", { class: "retrieval-row-body" }, [label, strip]);
      const cls = "retrieval-row" + (row.reference ? " is-reference" : "");
      return els("div", { class: cls }, [queryCell, body]);
    });

    return els("div", { class: "retrieval-box" }, [
      els("div", { class: "retrieval-rows" }, rowsEls),
    ]);
  }

  function render(data, root) {
    const queries = data.queries || [];
    const n = queries.length;
    if (!n) {
      root.appendChild(els("div", { class: "retrieval-empty", text: "No retrieval examples." }));
      return;
    }

    // A single "stage" holds the active query. Switching queries swaps the box
    // in place and replays the switch animation (images rotate in, labels fade)
    // rather than sliding the whole strip.
    const built = queries.map(q => buildBox(q));
    const stage = els("div", { class: "retrieval-stage" });
    const viewport = els("div", { class: "retrieval-viewport" }, [stage]);

    const prev = els("button", { class: "ex-nav-btn is-prev", type: "button",
                                 "aria-label": "Previous query", html: "&#8249;" });
    const next = els("button", { class: "ex-nav-btn is-next", type: "button",
                                 "aria-label": "Next query", html: "&#8250;" });
    const dots = els("div", { class: "ex-dots" });
    const dotEls = queries.map((q, i) => {
      const d = els("button", { class: "ex-dot", type: "button",
                                title: `Query ${i + 1}`, "aria-label": `Query ${i + 1}` });
      d.addEventListener("click", () => goto(i));
      dots.appendChild(d);
      return d;
    });
    const controls = els("div", { class: "retrieval-controls" }, [prev, dots, next]);
    const card = els("div", { class: "retrieval-card" }, [controls, viewport]);

    let idx = -1;
    const setDots = () => dotEls.forEach((d, i) => d.classList.toggle("is-active", i === idx));
    const setNav = () => { prev.disabled = idx === 0; next.disabled = idx === n - 1; };

    function goto(i) {
      i = Math.max(0, Math.min(n - 1, i));
      if (i === idx) return;
      idx = i;
      const box = built[idx];
      stage.textContent = "";
      stage.appendChild(box);
      // replay the switch animation
      box.classList.remove("is-switching");
      void box.offsetWidth;
      box.classList.add("is-switching");
      setDots();
      setNav();
    }

    prev.addEventListener("click", () => goto(idx - 1));
    next.addEventListener("click", () => goto(idx + 1));

    root.appendChild(card);
    goto(0);
  }

  async function main() {
    const root = document.getElementById("aspect-retrieval-root");
    if (!root) return;
    try {
      const data = await fetchJSON(`${ROOT_DIR}/manifest.json`);
      root.innerHTML = "";
      render(data, root);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="retrieval-empty">Failed to load retrieval: ${err.message}</div>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
