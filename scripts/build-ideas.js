#!/usr/bin/env node
/* =====================================================================
   build-ideas.js  —  pre-builds one full HTML page per blog article.

   Reads:   content/posts/*.md   (Decap-authored Markdown + front matter)
   Writes:  ideas/<slug>/index.html   (a real page with baked-in OG/Twitter
                                        meta so social shares show the article
                                        title), plus ideas/posts.json (the
                                        index the homepage cards consume).

   No framework. Runs at Vercel build time (and locally via `npm run build`).
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const OUT_DIR = path.join(ROOT, 'ideas');
const SITE = 'https://wael-saleh.com';
const DEFAULT_OG_IMAGE = SITE + '/assets/images/wael.jpg';

/* ---------- tiny helpers ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function slugify(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents (Latin)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')             // keep latin + arabic
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

/* ---------- front matter (handles folded YAML + CRLF) ---------- */
function coerce(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return v;
}
function parseFrontMatter(raw) {
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const m = /^﻿?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data = {};
  let key = null, val = '';
  const flush = () => { if (key !== null) data[key] = coerce(val); key = null; val = ''; };
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (kv && !/^\s/.test(line)) { flush(); key = kv[1]; val = kv[2]; }
    else if (key !== null && line.trim()) { val += ' ' + line.trim(); }
  }
  flush();
  return { data, body: m[2] };
}

/* ---------- minimal, safe Markdown -> HTML ---------- */
function inline(t) {
  t = esc(t);
  t = t.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, txt, href) => '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>');
  return t;
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { const lvl = h[1].length; html += `<h${lvl}>` + inline(h[2]) + `</h${lvl}>`; i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += '<blockquote>' + inline(buf.join(' ')) + '</blockquote>'; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { buf.push('<li>' + inline(lines[i].replace(/^[-*]\s+/, '')) + '</li>'); i++; }
      html += '<ul>' + buf.join('') + '</ul>'; continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { buf.push('<li>' + inline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>'); i++; }
      html += '<ol>' + buf.join('') + '</ol>'; continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|[-*]\s|\d+\.\s)/.test(lines[i])) { buf.push(lines[i]); i++; }
    html += '<p>' + inline(buf.join(' ')) + '</p>';
  }
  return html;
}

/* ---------- date formatting per language ---------- */
function fmtDate(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  const locale = lang === 'ar' ? 'ar' : (lang === 'fr' ? 'fr-FR' : 'en-US');
  try { return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return iso; }
}

/* ---------- per-article page template ---------- */
const BACK_LABEL = { en: 'Ideas to Share', fr: 'Idées à partager', ar: 'أفكار للمشاركة' };
const OG_LOCALE = { en: 'en_US', fr: 'fr_FR', ar: 'ar_AR' };

function renderPage(post) {
  const isRtl = post.lang === 'ar';
  const url = `${SITE}/ideas/${post.slug}/`;
  const title = post.title;
  const desc = post.excerpt || post.title;
  const img = post.image ? (post.image.startsWith('http') ? post.image : SITE + post.image) : DEFAULT_OG_IMAGE;
  const back = BACK_LABEL[post.lang] || BACK_LABEL.en;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: desc,
    inLanguage: post.lang,
    datePublished: post.date,
    author: { '@type': 'Person', name: 'Wael Saleh', url: SITE },
    publisher: { '@type': 'Person', name: 'Wael Saleh' },
    mainEntityOfPage: url,
    image: img,
  };

  return `<!doctype html>
<html lang="${esc(post.lang)}" dir="${isRtl ? 'rtl' : 'ltr'}" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>${esc(title)} — Wael Saleh</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="author" content="Wael Saleh" />
  <link rel="canonical" href="${esc(url)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#FBF6F1" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0E1016" media="(prefers-color-scheme: dark)" />

  <!-- Open Graph (per-article: Facebook/LinkedIn/WhatsApp show THIS title) -->
  <meta property="og:site_name" content="Dr. Wael Saleh" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="${OG_LOCALE[post.lang] || 'en_US'}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(img)}" />
  <meta property="og:image:alt" content="${esc(title)}" />
  <meta property="article:published_time" content="${esc(post.date)}" />
  <meta property="article:author" content="Wael Saleh" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${esc(img)}" />

  <link rel="icon" type="image/jpeg" href="/assets/images/wael.jpg" />
  <link rel="apple-touch-icon" href="/assets/images/wael.jpg" />

  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <script type="application/ld+json">${JSON.stringify(ld)}</script>

  <style>
    :root{
      --c-cream:251 246 241; --c-ivory:255 251 247; --c-charcoal:31 27 22;
      --c-ink:45 40 32; --c-muted:107 98 86; --c-line:232 223 211;
      --coral-600:#D94518; --coral-700:#A8330F; --coral-400:#FF6F44;
    }
    @media (prefers-color-scheme: dark){
      :root{
        --c-cream:14 16 22; --c-ivory:22 25 34; --c-charcoal:244 235 222;
        --c-ink:214 206 192; --c-muted:138 138 152; --c-line:40 44 56;
        --coral-600:#FF8C5A; --coral-700:#FFA26E; --coral-400:#FF8C5A;
      }
    }
    *{box-sizing:border-box;}
    html,body{margin:0;background:rgb(var(--c-cream));color:rgb(var(--c-charcoal));}
    body{font-family:'Inter',system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;}
    [dir="rtl"] body{font-family:'Noto Naskh Arabic','Amiri',serif;}
    .wrap{max-width:720px;margin:0 auto;padding:0 20px;}
    .topbar{border-bottom:1px solid rgb(var(--c-line));}
    .topbar .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;}
    .brand{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.35rem;font-weight:600;color:rgb(var(--c-charcoal));text-decoration:none;}
    [dir="rtl"] .brand{font-family:'Amiri','Noto Naskh Arabic',serif;}
    .back{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:rgb(var(--c-muted));text-decoration:none;}
    .back:hover{color:var(--coral-600);}
    .back svg{width:15px;height:15px;}
    [dir="rtl"] .back svg{transform:scaleX(-1);}
    article{padding:48px 0 80px;}
    .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--coral-600);margin:0 0 14px;}
    h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:clamp(2rem,5vw,3rem);line-height:1.12;color:rgb(var(--c-charcoal));margin:0 0 8px;overflow-wrap:anywhere;}
    [dir="rtl"] h1{font-family:'Amiri','Noto Naskh Arabic',serif;line-height:1.5;}
    .badge{display:inline-block;font-size:11px;letter-spacing:.16em;font-weight:600;color:var(--coral-700);
      background:rgba(217,69,24,.08);border:1px solid rgba(217,69,24,.18);border-radius:999px;padding:2px 9px;margin-top:6px;}
    .prose{margin-top:32px;font-size:17px;color:rgb(var(--c-ink));}
    .prose>*+*{margin-top:1.15em;}
    .prose h1,.prose h2,.prose h3{font-family:'Cormorant Garamond',Georgia,serif;color:rgb(var(--c-charcoal));line-height:1.2;margin-top:1.5em;}
    [dir="rtl"] .prose h1,[dir="rtl"] .prose h2,[dir="rtl"] .prose h3{font-family:'Amiri','Noto Naskh Arabic',serif;}
    .prose h2{font-size:1.6rem;} .prose h3{font-size:1.3rem;}
    .prose a{color:var(--coral-600);text-underline-offset:2px;}
    .prose strong{font-weight:600;color:rgb(var(--c-charcoal));}
    .prose blockquote{margin:0;border-inline-start:2px solid var(--coral-400);padding-inline-start:18px;
      font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem;font-style:italic;color:rgb(var(--c-charcoal));}
    [dir="rtl"] .prose blockquote{font-family:'Amiri','Noto Naskh Arabic',serif;}
    .prose ul,.prose ol{padding-inline-start:1.4em;} .prose li+li{margin-top:.4em;}
    .footer{border-top:1px solid rgb(var(--c-line));padding:28px 0;color:rgb(var(--c-muted));font-size:13px;}
    .footer a{color:rgb(var(--c-muted));}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="wrap">
      <a class="brand" href="/">Wael Saleh</a>
      <a class="back" href="/#ideas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        ${esc(back)}
      </a>
    </div>
  </header>

  <main class="wrap">
    <article>
      <p class="eyebrow">${esc(fmtDate(post.date, post.lang))}</p>
      <h1>${esc(title)}</h1>
      <div><span class="badge">${esc((post.lang || 'en').toUpperCase())}</span></div>
      <div class="prose">${post.bodyHtml}</div>
    </article>
  </main>

  <footer class="footer">
    <div class="wrap">© <span id="y"></span> Wael Saleh · <a href="/#ideas">${esc(back)}</a></div>
  </footer>
  <script>document.getElementById('y').textContent=new Date().getFullYear();</script>
</body>
</html>`;
}

/* ---------- main ---------- */
function main() {
  let files = [];
  try { files = fs.readdirSync(POSTS_DIR).filter((f) => f.toLowerCase().endsWith('.md')); }
  catch { console.log('[ideas] no content/posts dir; nothing to build'); }

  const index = [];
  const usedSlugs = new Set();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const { data, body } = parseFrontMatter(raw);
    if (data.draft === true) continue;

    // Prefer an explicit slug; else slugify the title; else the filename.
    let slug = data.slug ? slugify(data.slug) : slugify(data.title || file.replace(/\.md$/i, ''));
    while (usedSlugs.has(slug)) slug += '-2';
    usedSlugs.add(slug);

    const post = {
      slug,
      title: data.title || '(untitled)',
      lang: (data.lang || 'en').toLowerCase(),
      date: data.date || '',
      excerpt: data.excerpt || '',
      image: data.image || '',
      bodyHtml: mdToHtml(body),
    };

    const dir = path.join(OUT_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(post), 'utf8');

    index.push({
      slug, title: post.title, lang: post.lang, date: post.date, excerpt: post.excerpt,
      url: `/ideas/${slug}/`,
    });
    console.log(`[ideas] built /ideas/${slug}/`);
  }

  // newest first
  index.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'posts.json'), JSON.stringify({ posts: index }, null, 2), 'utf8');
  console.log(`[ideas] wrote ideas/posts.json (${index.length} posts)`);
}

main();
