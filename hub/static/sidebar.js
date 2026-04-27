// hub/static/sidebar.js
//
// Unifying address sidebar — topic rail + auxiliary panel injected on every
// authenticated page. Reads /api/nest/topics. Vanilla, no dependencies.

(function () {
  if (window.__nestSidebar) return;
  window.__nestSidebar = true;

  const STORAGE_TOPIC = 'nest-sidebar-topic';
  const STORAGE_COLLAPSED = 'nest-sidebar-collapsed';
  const RAIL = 64;
  const PANEL = 220;

  // U+FE0E forces text-style (monochrome) rendering for the gear glyph.
  const GLYPHS = {
    Live: '●',
    Interact: '▶',
    Inspect: '◎',
    Configure: '⚙︎',
    Plan: '◇',
  };

  injectStyle();

  fetch('/api/nest/topics', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(({ topics }) => mount(topics))
    .catch((err) => console.warn('[nest-sidebar] failed to load topics:', err));

  function mount(topics) {
    const currentPath = window.location.pathname;
    const containing = topicContaining(topics, currentPath);
    // Current page wins over localStorage so deep-linking lands you in context.
    const initialOpen =
      containing ||
      localStorage.getItem(STORAGE_TOPIC) ||
      (topics[0] && topics[0].topic);

    if (localStorage.getItem(STORAGE_COLLAPSED) === '1') {
      document.body.classList.add('nest-sidebar-collapsed');
    }
    document.body.classList.add('nest-sidebar-mounted');

    const state = { openTopic: initialOpen };
    const rail = el('nav', 'nest-rail');
    const panel = el('aside', 'nest-panel');

    function render() {
      rail.replaceChildren(buildCollapseToggle(), ...topics.map((t) => buildRailItem(t, state, render)));
      panel.replaceChildren(...buildPanelChildren(topics, state, currentPath));
    }

    render();
    document.body.appendChild(rail);
    document.body.appendChild(panel);
  }

  function buildCollapseToggle() {
    const btn = el('button', 'nest-collapse');
    btn.type = 'button';
    btn.title = 'Toggle panel';
    const sync = () => {
      btn.textContent = document.body.classList.contains('nest-sidebar-collapsed') ? '›' : '‹';
    };
    sync();
    btn.addEventListener('click', () => {
      document.body.classList.toggle('nest-sidebar-collapsed');
      const collapsed = document.body.classList.contains('nest-sidebar-collapsed');
      localStorage.setItem(STORAGE_COLLAPSED, collapsed ? '1' : '0');
      sync();
    });
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
      if (document.body.classList.contains('nest-sidebar-collapsed')) {
        document.body.classList.remove('nest-sidebar-collapsed');
        localStorage.setItem(STORAGE_COLLAPSED, '0');
      }
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

  function injectStyle() {
    const css = `
      body.nest-sidebar-mounted {
        padding-left: ${RAIL + PANEL}px;
        transition: padding-left 220ms ease;
      }
      body.nest-sidebar-mounted.nest-sidebar-collapsed { padding-left: ${RAIL}px; }
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
      body.nest-sidebar-collapsed .nest-panel {
        transform: translateX(-${PANEL}px);
        opacity: 0;
        pointer-events: none;
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
        body.nest-sidebar-mounted { padding-left: 0; }
        .nest-rail, .nest-panel { display: none; }
      }
    `;
    const style = document.createElement('style');
    style.setAttribute('data-nest-sidebar', '');
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
