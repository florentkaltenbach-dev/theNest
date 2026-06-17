// hub/static/sidebar.js
//
// Unifying address sidebar — topic rail + auxiliary panel injected on every
// authenticated page. Reads /api/nest/topics. Vanilla, no dependencies.
//
// Loaded synchronously in <head> so the layout reservation lands before first
// paint (no CLS). Layout classes live on <html> because <body> doesn't exist
// yet at head-time.

(function () {
  if (window.__nestSidebar) return;
  window.__nestSidebar = true;

  const STORAGE_TOPIC = 'nest-sidebar-topic';
  const STORAGE_COLLAPSED = 'nest-sidebar-collapsed';
  const STORAGE_TOPICS = 'nest-sidebar-topics';
  const RAIL = 64;
  const PANEL = 220;
  const MOBILE_RAIL = 56;
  const MOBILE_PANEL = 216;

  // U+FE0E forces text-style (monochrome) rendering for the gear glyph.
  const GLYPHS = {
    Live: '●',
    Interact: '▶',
    Inspect: '◎',
    Configure: '⚙︎',
    Plan: '◇',
  };

  const html = document.documentElement;
  html.classList.add('nest-sidebar');
  if (localStorage.getItem(STORAGE_COLLAPSED) === '1') {
    html.classList.add('nest-sidebar-collapsed');
  }
  injectStyle();

  // ctx is mutable: refs to mounted rail/panel + current state, so a later
  // refetch can re-render in place without rebuilding the DOM tree.
  const ctx = { rail: null, panel: null, mobileToggle: null, backdrop: null, state: null, topics: null };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    // Paint cached topics first so panel-link navigations show fully populated
    // sidebar from the same paint as the page content. Background refetch keeps
    // it fresh.
    const cached = readCache();
    if (cached) mount(cached);

    const token = localStorage.getItem('nest_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch('/api/nest/topics', { credentials: 'same-origin', headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ topics }) => {
        writeCache(topics);
        if (ctx.topics) refresh(topics);
        else mount(topics);
      })
      .catch((err) => {
        // Pre-auth or session expired — drop reservation and any stale shell.
        html.classList.remove('nest-sidebar');
        html.classList.remove('nest-sidebar-collapsed');
        closeMobileMenu();
        if (ctx.rail) ctx.rail.remove();
        if (ctx.panel) ctx.panel.remove();
        if (ctx.mobileToggle) ctx.mobileToggle.remove();
        if (ctx.backdrop) ctx.backdrop.remove();
        console.warn('[nest-sidebar] failed to load topics:', err);
      });
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(STORAGE_TOPICS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeCache(topics) {
    try { localStorage.setItem(STORAGE_TOPICS, JSON.stringify(topics)); } catch {}
  }

  function mount(topics) {
    const currentPath = window.location.pathname;
    const containing = topicContaining(topics, currentPath);
    // Current page wins over localStorage so deep-linking lands you in context.
    const initialOpen =
      containing ||
      localStorage.getItem(STORAGE_TOPIC) ||
      (topics[0] && topics[0].topic);

    ctx.state = { openTopic: initialOpen };
    ctx.topics = topics;
    ctx.rail = el('nav', 'nest-rail');
    ctx.panel = el('aside', 'nest-panel');
    ctx.mobileToggle = buildMobileToggle();
    ctx.backdrop = el('button', 'nest-mobile-backdrop');
    ctx.backdrop.type = 'button';
    ctx.backdrop.title = 'Close menu';
    ctx.backdrop.setAttribute('aria-label', 'Close menu');
    ctx.backdrop.addEventListener('click', closeMobileMenu);

    renderInto();
    document.body.appendChild(ctx.mobileToggle);
    document.body.appendChild(ctx.backdrop);
    document.body.appendChild(ctx.rail);
    document.body.appendChild(ctx.panel);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeMobileMenu();
    });
    window.addEventListener('resize', () => {
      if (!isMobile()) closeMobileMenu();
    });
  }

  function refresh(topics) {
    // Same shape if topics list hasn't structurally changed — skip the rerender
    // to avoid any visual jitter from replaceChildren.
    if (sameShape(ctx.topics, topics)) return;
    ctx.topics = topics;
    renderInto();
  }

  function renderInto() {
    const currentPath = window.location.pathname;
    ctx.rail.replaceChildren(
      buildCollapseToggle(),
      ...ctx.topics.map((t) => buildRailItem(t, ctx.state, renderInto)),
    );
    ctx.panel.replaceChildren(...buildPanelChildren(ctx.topics, ctx.state, currentPath));
  }

  function sameShape(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].topic !== b[i].topic) return false;
      if (a[i].pages.length !== b[i].pages.length) return false;
      for (let j = 0; j < a[i].pages.length; j++) {
        if (a[i].pages[j].path !== b[i].pages[j].path) return false;
        if (a[i].pages[j].title !== b[i].pages[j].title) return false;
      }
    }
    return true;
  }

  function buildCollapseToggle() {
    const btn = el('button', 'nest-collapse');
    btn.type = 'button';
    btn.title = 'Toggle panel';
    const sync = () => {
      btn.textContent = isMobile()
        ? '×'
        : html.classList.contains('nest-sidebar-collapsed') ? '›' : '‹';
    };
    sync();
    btn.addEventListener('click', () => {
      if (isMobile()) {
        closeMobileMenu();
        return;
      }
      html.classList.toggle('nest-sidebar-collapsed');
      const collapsed = html.classList.contains('nest-sidebar-collapsed');
      localStorage.setItem(STORAGE_COLLAPSED, collapsed ? '1' : '0');
      sync();
    });
    return btn;
  }

  function buildMobileToggle() {
    const btn = el('button', 'nest-mobile-menu');
    btn.type = 'button';
    btn.title = 'Open menu';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '☰';
    btn.addEventListener('click', toggleMobileMenu);
    return btn;
  }

  function buildRailItem(topic, state, render) {
    const btn = el('button', 'nest-rail-item');
    btn.type = 'button';
    if (topic.topic === state.openTopic) btn.classList.add('active');
    const glyph = el('span', 'nest-rail-glyph');
    glyph.textContent = GLYPHS[topic.topic] || '○';
    const label = el('span', 'nest-rail-label');
    label.textContent = topic.topic;
    btn.append(glyph, label);
    btn.addEventListener('click', () => {
      state.openTopic = topic.topic;
      localStorage.setItem(STORAGE_TOPIC, topic.topic);
      if (html.classList.contains('nest-sidebar-collapsed')) {
        html.classList.remove('nest-sidebar-collapsed');
        localStorage.setItem(STORAGE_COLLAPSED, '0');
      }
      if (isMobile()) openMobileMenu();
      render();
    });
    return btn;
  }

  function buildPanelChildren(topics, state, currentPath) {
    const open = topics.find((t) => t.topic === state.openTopic);
    if (!open) return [];

    const currentPage = open.pages.find((p) => p.path === currentPath);
    const addressText = currentPage ? `${open.topic} › ${currentPage.title}` : open.topic;

    const addr = el('div', 'nest-address');
    const txt = el('span', 'nest-address-text');
    txt.appendChild(document.createTextNode(open.topic));
    if (currentPage) {
      const sep = el('span', 'nest-address-sep');
      sep.textContent = '›';
      txt.appendChild(sep);
      txt.appendChild(document.createTextNode(currentPage.title));
    }
    const copy = el('button', 'nest-copy');
    copy.type = 'button';
    copy.title = 'Copy address';
    copy.textContent = '⧉';
    copy.addEventListener('click', () => copyAddress(copy, addressText));
    addr.append(txt, copy);

    const list = el('div', 'nest-pages');
    for (const p of open.pages) {
      const a = el('a', 'nest-page-link');
      a.href = p.path;
      a.textContent = p.title;
      if (p.path === currentPath) a.classList.add('active');
      a.addEventListener('click', () => closeMobileMenu());
      list.appendChild(a);
    }

    return [addr, list];
  }

  async function copyAddress(btn, text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (rare in this app, but cheap to keep).
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btn.classList.add('copied');
      btn.textContent = '✓';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = '⧉';
      }, 1200);
    } catch (e) {
      console.warn('[nest-sidebar] copy failed:', e);
    }
  }

  function topicContaining(topics, path) {
    for (const t of topics) {
      if (t.pages.some((p) => p.path === path)) return t.topic;
    }
    return null;
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function isMobile() {
    return window.matchMedia('(max-width: 720px)').matches;
  }

  function openMobileMenu() {
    html.classList.add('nest-sidebar-mobile-open');
    syncMobileToggle();
  }

  function closeMobileMenu() {
    html.classList.remove('nest-sidebar-mobile-open');
    syncMobileToggle();
  }

  function toggleMobileMenu() {
    html.classList.toggle('nest-sidebar-mobile-open');
    syncMobileToggle();
  }

  function syncMobileToggle() {
    if (!ctx.mobileToggle) return;
    const open = html.classList.contains('nest-sidebar-mobile-open');
    ctx.mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    ctx.mobileToggle.title = open ? 'Close menu' : 'Open menu';
    ctx.mobileToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    ctx.mobileToggle.textContent = open ? '×' : '☰';
  }

  function injectStyle() {
    const css = `
      html.nest-sidebar body {
        padding-left: ${RAIL + PANEL}px;
        transition: padding-left 220ms ease;
      }
      html.nest-sidebar.nest-sidebar-collapsed body { padding-left: ${RAIL}px; }
      .nest-rail {
        position: fixed; top: 0; left: 0; bottom: 0;
        width: ${RAIL}px;
        background: #1a1a2e;
        z-index: 1000;
        display: flex; flex-direction: column;
        font-family: ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", Consolas, monospace;
      }
      .nest-collapse {
        border: 0; background: transparent; color: #6b7280; cursor: pointer;
        height: 32px; font: inherit; font-size: 16px; font-weight: 700;
      }
      .nest-collapse:hover { color: #fff; }
      .nest-rail-item {
        width: 100%; padding: 10px 0;
        border: 0; background: transparent; cursor: pointer;
        color: #8b8fa3;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 4px;
        font: inherit;
      }
      .nest-rail-item:hover { color: #d7d9e0; }
      .nest-rail-item.active { color: #fff; background: #2a2a4a; }
      .nest-rail-glyph {
        font-size: 22px; line-height: 1; width: 32px; text-align: center;
      }
      .nest-rail-label {
        font-size: 9px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .nest-panel {
        position: fixed; top: 0; bottom: 0;
        left: ${RAIL}px;
        width: ${PANEL}px;
        background: #14142a;
        color: #fff;
        z-index: 999;
        display: flex; flex-direction: column;
        transform: translateX(0);
        transition: transform 220ms ease, opacity 220ms ease;
        border-right: 1px solid #2a2a4a;
        opacity: 1;
      }
      html.nest-sidebar-collapsed .nest-panel {
        transform: translateX(-${PANEL}px);
        opacity: 0;
        pointer-events: none;
      }
      .nest-mobile-menu,
      .nest-mobile-backdrop {
        display: none;
      }
      .nest-address {
        padding: 12px 14px;
        border-bottom: 1px solid #2a2a4a;
        font-family: ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", Consolas, monospace;
        font-size: 12px;
        color: #d7d9e0;
        display: flex; align-items: center; gap: 8px;
      }
      .nest-address-text { flex: 1; min-width: 0; word-break: break-word; }
      .nest-address-sep { color: #6b7280; margin: 0 6px; }
      .nest-copy {
        border: 0; background: transparent; color: #8b8fa3; cursor: pointer;
        font: inherit; font-size: 14px; padding: 4px 6px; border-radius: 4px;
        flex-shrink: 0;
      }
      .nest-copy:hover { color: #fff; background: #2a2a4a; }
      .nest-copy.copied { color: #22c55e; }
      .nest-pages { flex: 1; overflow-y: auto; padding: 8px 0; }
      .nest-page-link {
        display: block;
        padding: 9px 14px;
        color: #8b8fa3;
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
        border-left: 2px solid transparent;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .nest-page-link:hover { color: #fff; background: #1f1f3a; }
      .nest-page-link.active {
        color: #fff;
        border-left-color: #7eb8ff;
        background: #1f1f3a;
      }
      @media (max-width: 720px) {
        html.nest-sidebar body {
          padding-left: 0;
          padding-top: calc(54px + env(safe-area-inset-top));
          overflow-x: hidden;
        }
        html.nest-sidebar body > :not(.nest-rail):not(.nest-panel):not(.nest-mobile-menu):not(.nest-mobile-backdrop) {
          transition: transform 220ms ease;
        }
        html.nest-sidebar.nest-sidebar-mobile-open body > :not(.nest-rail):not(.nest-panel):not(.nest-mobile-menu):not(.nest-mobile-backdrop) {
          transform: translateX(${MOBILE_RAIL + MOBILE_PANEL}px);
        }
        .nest-mobile-menu {
          position: fixed;
          top: calc(7px + env(safe-area-inset-top));
          left: max(10px, env(safe-area-inset-left));
          z-index: 1102;
          width: 44px;
          height: 44px;
          border: 1px solid #2a2a4a;
          border-radius: 8px;
          background: #1a1a2e;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
          cursor: pointer;
          font: 700 24px/1 system-ui, -apple-system, sans-serif;
          transform: translateX(0);
          transition: transform 220ms ease, box-shadow 220ms ease;
        }
        html.nest-sidebar.nest-sidebar-mobile-open .nest-mobile-menu {
          opacity: 0;
          pointer-events: none;
        }
        .nest-mobile-backdrop {
          position: fixed;
          inset: 0;
          z-index: 998;
          border: 0;
          background: rgba(10, 10, 22, 0.48);
          cursor: pointer;
          display: block;
          opacity: 0;
          pointer-events: none;
          transition: opacity 220ms ease;
        }
        .nest-rail {
          display: flex;
          width: ${MOBILE_RAIL}px;
          z-index: 1101;
          transform: translateX(-${MOBILE_RAIL}px);
          transition: transform 220ms ease;
          box-shadow: 12px 0 24px rgba(0, 0, 0, 0.24);
        }
        .nest-collapse {
          height: 44px;
          font-size: 22px;
          color: #d7d9e0;
        }
        .nest-rail-item {
          padding: 9px 0;
        }
        .nest-rail-glyph {
          font-size: 20px;
          width: 28px;
        }
        .nest-rail-label {
          font-size: 8px;
          letter-spacing: 0;
        }
        .nest-panel {
          display: flex;
          left: ${MOBILE_RAIL}px;
          width: min(${MOBILE_PANEL}px, calc(100vw - ${MOBILE_RAIL}px));
          z-index: 1100;
          transform: translateX(-${MOBILE_RAIL + MOBILE_PANEL}px);
          opacity: 1;
          pointer-events: none;
        }
        .nest-address {
          display: none;
        }
        .nest-pages {
          padding-top: 0;
        }
        .nest-page-link {
          padding: 11px 14px;
          font-size: 14px;
        }
        html.nest-sidebar.nest-sidebar-mobile-open .nest-rail,
        html.nest-sidebar.nest-sidebar-mobile-open .nest-panel {
          transform: translateX(0);
          opacity: 1;
          pointer-events: auto;
        }
        html.nest-sidebar.nest-sidebar-mobile-open .nest-mobile-backdrop {
          opacity: 1;
          pointer-events: auto;
        }
      }
    `;
    const style = document.createElement('style');
    style.setAttribute('data-nest-sidebar', '');
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
