// GET /api/auth
// Step 1 of Decap CMS's GitHub OAuth flow: redirect the editor to GitHub's
// authorize screen. GitHub then sends them back to /api/callback with a code.
//
// Required Vercel environment variables:
//   GITHUB_OAUTH_CLIENT_ID      – from your GitHub OAuth App
//   GITHUB_OAUTH_CLIENT_SECRET  – from your GitHub OAuth App (used in callback)

const crypto = require('crypto');

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('Missing GITHUB_OAUTH_CLIENT_ID environment variable.');
    return;
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/callback`;

  // CSRF protection: random state echoed back by GitHub and re-checked in callback.
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `decap_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo,user',
    state,
  });

  res.writeHead(302, {
    Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
  res.end();
};
