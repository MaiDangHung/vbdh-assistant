/**
 * Background Service Worker - VBDH Assistant v2.0
 * Handles token refresh, message routing, and extension lifecycle
 */

const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VBDH_API_REQUEST') {
    handleApiRequest(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, status: 0, error: err.message }));
    return true; // async response
  }

  if (message.type === 'VBDH_REFRESH_TOKEN') {
    handleRefreshToken()
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'VBDH_GET_AUTH') {
    getAuth().then(sendResponse);
    return true;
  }

  if (message.type === 'VBDH_GET_CONFIG') {
    getConfig().then(sendResponse);
    return true;
  }
});

// ===== API REQUEST (with auto token refresh) =====

async function handleApiRequest(message, sender) {
  const { url, method, headers, body, authType } = message;
  const config = await getConfig();
  const fullUrl = url.startsWith('http') ? url : config.apiBase + url;

  // Build headers
  const reqHeaders = { ...(headers || {}) };

  if (authType === 'jwt') {
    const auth = await getAuth();
    if (auth.token) {
      reqHeaders['Authorization'] = 'Bearer ' + auth.token;
    }
  } else if (authType === 'apikey') {
    if (config.apiKey) {
      reqHeaders['X-API-Key'] = config.apiKey;
      reqHeaders['X-Service-Name'] = 'vbdh-assistant';
    }
  }

  const fetchOpts = {
    method: method || 'GET',
    headers: reqHeaders,
  };
  if (body && method !== 'GET') {
    fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let res = await fetch(fullUrl, fetchOpts);

  // Auto-refresh on 401 for JWT requests
  if (res.status === 401 && authType === 'jwt') {
    const refreshed = await handleRefreshToken();
    if (refreshed && refreshed.ok) {
      // Retry with new token
      const newAuth = await getAuth();
      reqHeaders['Authorization'] = 'Bearer ' + newAuth.token;
      res = await fetch(fullUrl, fetchOpts);
    } else {
      // Refresh failed — signal logout needed
      return { ok: false, status: 401, error: 'SESSION_EXPIRED', needsLogin: true };
    }
  }

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return {
    ok: res.ok,
    status: res.status,
    data: data,
  };
}

// ===== TOKEN REFRESH =====

async function handleRefreshToken() {
  const auth = await getAuth();
  const config = await getConfig();

  if (!auth.refreshToken) {
    return { ok: false, error: 'No refresh token' };
  }

  try {
    const res = await fetch(config.apiBase + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });

    if (!res.ok) {
      // Refresh failed — clear auth
      await clearAuth();
      return { ok: false, error: 'Refresh failed' };
    }

    const json = await res.json();
    const data = json.data || json;

    await new Promise(r => chrome.storage.local.set({
      vbdh_token: data.token,
      vbdh_refresh_token: data.refreshToken,
      vbdh_role: data.role,
      vbdh_user_id: data.userId,
      vbdh_full_name: data.fullName,
      vbdh_username: data.username,
    }, r));

    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ===== STORAGE HELPERS =====

function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username'],
      (result) => {
        resolve({
          token: result.vbdh_token || '',
          refreshToken: result.vbdh_refresh_token || '',
          role: result.vbdh_role || '',
          userId: result.vbdh_user_id || '',
          fullName: result.vbdh_full_name || '',
          username: result.vbdh_username || '',
        });
      }
    );
  });
}

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vbdh_api_url', 'vbdh_api_key'], (result) => {
      resolve({
        apiBase: result.vbdh_api_url || DEFAULT_API_BASE,
        apiKey: result.vbdh_api_key || '',
      });
    });
  });
}

function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([
      'vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username',
    ], resolve);
  });
}
