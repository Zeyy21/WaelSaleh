// GET /api/callback
// Step 2 of Decap CMS's GitHub OAuth flow: exchange the `code` GitHub returned
// for an access token, then hand that token back to the Decap admin window via
// postMessage (the message format Decap listens for).
//
// Uses the global fetch available in Vercel's Node runtime. No dependencies.

function page(status, contentJson) {
  // Decap listens for a message of the form:
  //   "authorization:github:success:{...}"  /  "...:error:{...}"
  return `<!doctype html><html><body><script>
  (function() {
    function send(message) {
      window.opener && window.opener.postMessage(message, "*");
    }
    var done = false;
    function receive(e) {
      if (done) return; done = true;
      send('authorization:github:${status}:${contentJson}');
      window.removeEventListener('message', receive, false);
      setTimeout(function(){ window.close(); }, 300);
    }
    window.addEventListener('message', receive, false);
    // Kick off the handshake.
    send('authorizing:github');
  })();
  </script><p>Completing sign-in…</p></body></html>`;
}

module.exports = async (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!clientId || !clientSecret) {
    res.status(500).send('Missing GitHub OAuth environment variables.');
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Verify CSRF state against the cookie set in /api/auth.
  const cookie = req.headers.cookie || '';
  const expected = (cookie.match(/decap_oauth_state=([^;]+)/) || [])[1];
  if (!code || !state || !expected || state !== expected) {
    res.status(400).send(page('error', JSON.stringify({ message: 'Invalid OAuth state.' })));
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await tokenRes.json();

    if (data.error || !data.access_token) {
      res.status(401).send(page('error', JSON.stringify({ message: data.error_description || 'Token exchange failed.' })));
      return;
    }

    // Clear the state cookie now that it's been used.
    res.setHeader('Set-Cookie', 'decap_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    res.status(200).send(
      page('success', JSON.stringify({ token: data.access_token, provider: 'github' }))
    );
  } catch (err) {
    res.status(500).send(page('error', JSON.stringify({ message: 'OAuth exchange error.' })));
  }
};
