let tokenCache = { token: null, expiresAt: 0 };

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const tokenUrl = required('FUEL_FINDER_TOKEN_URL');
  const clientId = required('FUEL_FINDER_CLIENT_ID');
  const clientSecret = required('FUEL_FINDER_CLIENT_SECRET');
  const scope = process.env.FUEL_FINDER_SCOPE;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) body.set('scope', scope);

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) throw new Error(`Fuel Finder token request failed (${response.status})`);
  const json = await response.json();
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in || 300) * 1000),
  };
  return tokenCache.token;
}

export async function fuelFinderGet(path, params = {}) {
  const apiBase = required('FUEL_FINDER_API_BASE_URL').replace(/\/$/, '');
  const token = await getAccessToken();
  const url = new URL(`${apiBase}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Fuel Finder API request failed (${response.status})`);
  return response.json();
}
