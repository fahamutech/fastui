/**
 * FastUI Docs — client-side nav, markdown renderer, search
 * Zero external dependencies: uses marked.js loaded from CDN in index.html
 */

const PAGES = [
  {
    group: 'Getting Started',
    items: [
      { id: 'index',        label: 'Overview & Quick Start', file: 'index.md' },
      { id: 'architecture', label: 'Architecture',           file: 'architecture.md' },
    ],
  },
  {
    group: 'Spec Files',
    items: [
      { id: 'spec-reference', label: 'Spec Reference',     file: 'spec-reference.md' },
      { id: 'composition',    label: 'Composition Model',  file: 'composition.md' },
    ],
  },
  {
    group: 'Figma Integration',
    items: [
      { id: 'figma-to-spec', label: 'Figma → Spec',  file: 'figma-to-spec.md' },
    ],
  },
  {
    group: 'Code Generation',
    items: [
      { id: 'generators', label: 'Generators & Services', file: 'generators.md' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { id: 'cli', label: 'CLI Reference', file: 'cli.md' },
    ],
  },
];

// ── State ────────────────────────────────────────────────────────────────────
let currentPage = null;
let searchIndex = [];   // [{id, label, file, text}]
let searchDebounce = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const sidebar        = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebar-toggle');
const sidebarNav     = document.getElementById('sidebar-nav');
const contentEl      = document.getElementById('content');
const breadcrumbEl   = document.getElementById('breadcrumb');
const searchBox      = document.getElementById('search-box');
const searchResults  = document.getElementById('search-results');
const tocEl          = document.getElementById('toc');

// ── Sidebar nav ──────────────────────────────────────────────────────────────
function buildSidebar() {
  sidebarNav.innerHTML = '';
  for (const group of PAGES) {
    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const titleEl = document.createElement('div');
    titleEl.className = 'nav-group-title';
    titleEl.textContent = group.group;
    groupEl.appendChild(titleEl);
    for (const item of group.items) {
      const a = document.createElement('a');
      a.className = 'nav-item';
      a.textContent = item.label;
      a.dataset.id = item.id;
      a.addEventListener('click', () => {
        navigateTo(item.id);
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
      });
      groupEl.appendChild(a);
    }
    sidebarNav.appendChild(groupEl);
  }
}

function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

// ── Routing ──────────────────────────────────────────────────────────────────
function pageFromHash() {
  const hash = location.hash.replace('#', '').trim();
  for (const group of PAGES) {
    for (const item of group.items) {
      if (item.id === hash) return item;
    }
  }
  return PAGES[0].items[0];
}

function allItems() {
  return PAGES.flatMap(g => g.items);
}

function navigateTo(id) {
  const item = allItems().find(i => i.id === id);
  if (!item) return;
  location.hash = id;
  loadPage(item);
}

// ── Page loading ─────────────────────────────────────────────────────────────
async function loadPage(item) {
  if (currentPage === item.id) return;
  currentPage = item.id;
  setActiveNav(item.id);
  breadcrumbEl.innerHTML = `FastUI Docs &rsaquo; <span>${item.label}</span>`;
  contentEl.innerHTML = '<div style="padding:40px;color:var(--text-dim);font-size:0.9rem;">Loading…</div>';
  tocEl.innerHTML = '';

  let md = '';
  try {
    const resp = await fetch(item.file);
    if (!resp.ok) throw new Error(resp.statusText);
    md = await resp.text();
  } catch (e) {
    contentEl.innerHTML = `<div class="md"><p style="color:#f87171">Failed to load ${item.file}: ${e.message}</p></div>`;
    return;
  }

  const html = renderMarkdown(md);
  contentEl.innerHTML = `<div class="md">${html}</div>`;

  // Syntax highlight (simple tokenizer — no external dep)
  highlightCodeBlocks();
  // Build on-page TOC
  buildToc();
  // Scroll to top
  document.getElementById('content-wrap').scrollTo(0, 0);

  // Index this page for search
  indexPage(item, md);
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMarkdown(md) {
  // If marked is loaded from CDN use it, else fall back to minimal renderer
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: false });
    return window.marked.parse(md);
  }
  return minimalMarkdown(md);
}

function minimalMarkdown(md) {
  // Minimal fallback — handles the patterns in these docs
  let html = escapeForFallback(md);

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langTag = lang ? `<span class="lang-tag">${lang}</span>` : '';
    return `<pre>${langTag}<code>${code.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`;
  });

  // Tables
  html = html.replace(/(\|.+\|\n)(\|[-| :]+\|\n)((?:\|.+\|\n?)*)/g, (_, head, _sep, body) => {
    const th = head.trim().split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Headings
  html = html.replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>');

  // HR
  html = html.replace(/^---$/gm, '<hr>');

  // Inline: bold, italic, code, link
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists
  html = html.replace(/(^- .+\n?)+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[a-z])([\s\S]+?)(?=\n\n|\n<|\n$|$)/gm, (line) => {
    const t = line.trim();
    if (!t || t.startsWith('<')) return line;
    return `<p>${t}</p>`;
  });

  return html;
}

function escapeForFallback(str) {
  // Only escape angle brackets outside code blocks
  return str;
}

// ── Syntax highlighting ───────────────────────────────────────────────────────
const TOKEN_PATTERNS = [
  { cls: 'kw',  re: /\b(import|export|from|const|let|var|function|class|return|async|await|if|else|for|of|in|new|this|extends|super|static|default|null|undefined|true|false|void|typeof|instanceof|delete)\b/g },
  { cls: 'str', re: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g },
  { cls: 'cmt', re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g },
  { cls: 'num', re: /\b(\d+\.?\d*)\b/g },
  { cls: 'fn',  re: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g },
  // YAML keys
  { cls: 'yk',  re: /^(\s*[a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/gm },
];

const CSS_COLORS = {
  kw:  '#c792ea',
  str: '#c3e88d',
  cmt: '#546e7a',
  num: '#f78c6c',
  fn:  '#82aaff',
  yk:  '#89ddff',
};

function highlightCodeBlocks() {
  document.querySelectorAll('#content pre code').forEach(el => {
    let text = el.textContent;
    // Escape HTML entities first
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Placeholder store — use letters-only keys so digit regex never hits them
    const spans = [];
    const PH_OPEN = '\uE000';   // private-use Unicode — safe, never in docs text
    const PH_CLOSE = '\uE001';
    const addSpan = (cls, value) => {
      const idx = spans.length;
      spans.push(`<span style="color:${CSS_COLORS[cls]}">${value}</span>`);
      return `${PH_OPEN}${idx}${PH_CLOSE}`;
    };
    // Regex that matches only outside placeholders — skip text between PH_OPEN…PH_CLOSE
    const outside = (re, fn) => {
      let result = '';
      let last = 0;
      // Split text on placeholder regions, only apply re to gaps
      const phRe = new RegExp(`${PH_OPEN}\\d+${PH_CLOSE}`, 'g');
      let m;
      while ((m = phRe.exec(text)) !== null) {
        result += text.slice(last, m.index).replace(re, fn);
        result += m[0];
        last = m.index + m[0].length;
      }
      result += text.slice(last).replace(re, fn);
      text = result;
    };

    // 1. Comments first (protect them from everything else)
    outside(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, m => addSpan('cmt', m));
    // 2. Strings
    outside(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, m => addSpan('str', m));
    // 3. YAML keys (word at start of line followed by colon)
    outside(/^(\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)(?=\s*:)/gm, (_, ws, key) => ws + addSpan('yk', key));
    // 4. Numbers — only standalone, not part of words or placeholder indices
    outside(/(?<![a-zA-Z_$\uE000])\b(\d+\.?\d*)\b(?![a-zA-Z%])/g, m => addSpan('num', m));
    // 5. JS/Dart keywords
    outside(/\b(import|export|from|const|let|var|function|class|return|async|await|if|else|for|of|in|new|this|extends|super|static|default|null|undefined|true|false|void|typeof|instanceof|delete|final|override|Widget|BuildContext|StatelessWidget|StatefulWidget|State)\b/g, m => addSpan('kw', m));
    // 6. Function calls
    outside(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g, (_, name) => addSpan('fn', name));

    // Restore placeholders
    text = text.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, i) => spans[+i]);
    el.innerHTML = text;
  });
}

// ── On-page TOC ───────────────────────────────────────────────────────────────
function buildToc() {
  const headings = contentEl.querySelectorAll('h2, h3');
  if (headings.length < 2) { tocEl.innerHTML = ''; return; }

  let html = `<div id="toc-title">On this page</div>`;
  headings.forEach((h, i) => {
    if (!h.id) h.id = `heading-${i}`;
    const cls = h.tagName === 'H3' ? 'toc-link h3' : 'toc-link';
    html += `<a class="${cls}" href="#${h.id}">${h.textContent}</a>`;
  });
  tocEl.innerHTML = html;

  // Active tracking on scroll
  const links = tocEl.querySelectorAll('.toc-link');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`));
      }
    });
  }, { rootMargin: '0px 0px -70% 0px' });
  headings.forEach(h => observer.observe(h));
}

// ── Search ────────────────────────────────────────────────────────────────────
function indexPage(item, md) {
  // Remove duplicate entries for this page
  searchIndex = searchIndex.filter(e => e.id !== item.id);
  // Strip markdown syntax for plain text
  const text = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
  searchIndex.push({ ...item, text });
}

function doSearch(query) {
  if (!query.trim()) { searchResults.classList.remove('open'); return; }
  const q = query.toLowerCase();
  const results = searchIndex
    .map(item => {
      const titleScore = item.label.toLowerCase().includes(q) ? 2 : 0;
      const textScore  = item.text.toLowerCase().includes(q) ? 1 : 0;
      return { ...item, score: titleScore + textScore };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!results.length) {
    searchResults.innerHTML = `<div class="search-result-item"><div class="sr-title" style="color:var(--text-dim)">No results for "${query}"</div></div>`;
  } else {
    searchResults.innerHTML = results.map(r => {
      const excerpt = extractExcerpt(r.text, q);
      return `<div class="search-result-item" data-id="${r.id}">
        <div class="sr-title">${highlight(r.label, q)}</div>
        <div class="sr-excerpt">${highlight(excerpt, q)}</div>
      </div>`;
    }).join('');
    searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        navigateTo(el.dataset.id);
        searchResults.classList.remove('open');
        searchBox.value = '';
      });
    });
  }
  searchResults.classList.add('open');
}

function extractExcerpt(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 80) + '…';
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function highlight(text, query) {
  if (!query) return text;
  return text.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<mark>$1</mark>');
}

// ── Sidebar toggle (mobile) ───────────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
document.addEventListener('click', e => {
  if (!sidebar.contains(e.target) && e.target !== sidebarToggle) sidebar.classList.remove('open');
});

// ── Search events ─────────────────────────────────────────────────────────────
searchBox.addEventListener('input', e => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doSearch(e.target.value), 200);
});
searchBox.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchResults.classList.remove('open'); searchBox.value = ''; }
});
document.addEventListener('click', e => {
  if (!searchBox.contains(e.target) && !searchResults.contains(e.target)) {
    searchResults.classList.remove('open');
  }
});

// ── Hash routing ──────────────────────────────────────────────────────────────
window.addEventListener('hashchange', () => loadPage(pageFromHash()));

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  buildSidebar();
  // Pre-load all pages into search index in background
  for (const item of allItems()) {
    try {
      const resp = await fetch(item.file);
      if (resp.ok) indexPage(item, await resp.text());
    } catch (_) {}
  }
  loadPage(pageFromHash());
}

boot();
