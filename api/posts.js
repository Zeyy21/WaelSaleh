// GET /api/posts
// Lists the Markdown blog entries that live in content/posts so the static
// front-end can discover them at runtime (no build step). Returns:
//   { "files": ["2026-05-31-knowledge-and-power-en.md", ...] }
//
// Runs on Vercel's Node serverless runtime. No external dependencies.

const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const dir = path.join(process.cwd(), 'content', 'posts');
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.md'));
  } catch (err) {
    // Folder may not exist yet (no posts published). Treat as empty.
    files = [];
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Posts change rarely but should not be cached aggressively at the edge.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json({ files });
};
