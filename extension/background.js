/**
 * Background Service Worker - VBDH Assistant v2.0
 * Handles token refresh, message routing, and extension lifecycle
 */

const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

// Debug: confirm service worker loaded
console.log('[VBDH] background.js loaded - v2.0.1-debug');

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

  // Open modal panel — inject auth + inject.js into page
  if (message.type === 'VBDH_OPEN_PANEL') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId) {
      sendResponse({ ok: false, error: 'No tab' });
      return;
    }
    (async () => {
      try {
        // Set auth on window
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          world: 'MAIN',
          func: (auth) => {
            window.__vbdhAuth = auth;
          },
          args: [message.auth],
        });
        // Inject modal script
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          world: 'MAIN',
          files: ['inject.js'],
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // Extract documents from QLVBDH page (MAIN world script execution)
  if (message.type === 'VBDH_EXTRACT_DOCS') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId) {
      sendResponse({ docs: [] });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        function extractAllDocuments() {
          const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
          const docs = [];
          wrappers.forEach(function(w) {
            if (w.offsetHeight > 0 && w.querySelector('.file') && w.querySelector('td.bold') && w.querySelector('.file__name')) {
              var info = {};
              w.querySelectorAll('tr').forEach(function(row) {
                var cells = row.querySelectorAll('td');
                cells.forEach(function(cell, idx) {
                  if (cell.classList.contains('bold') && idx + 1 < cells.length) {
                    info[cell.textContent.trim()] = cells[idx + 1].textContent.trim();
                  }
                });
              });
              var files = [];
              var rk = Object.keys(w).find(function(k) { return k.startsWith('__reactFiber$'); });
              if (!rk) return;
              var fiber = w[rk];
              var current = fiber.child && fiber.child.child && fiber.child.child;
              if (!current) return;
              var sibling = current;
              var maxSearch = 100;
              while (sibling && maxSearch-- > 0) {
                var p = sibling.memoizedProps;
                if (p && Array.isArray(p.files) && p.files.length > 0 && p.files[0].tenTep) {
                  files = p.files.map(function(f) { return { name: f.tenTep, url: f.url, mimeType: f.kieuTep || 'application/pdf' }; });
                  break;
                }
                if (sibling.sibling) sibling = sibling.sibling;
                else if (sibling.child) sibling = sibling.child;
                else { var pr = sibling.return; while (pr && !pr.sibling) pr = pr.return; sibling = pr && pr.sibling; }
              }
              if (files.length > 0) {
                docs.push({
                  soKyHieu: info['Số, ký hiệu VB'] || '',
                  trichYeu: info['Trích yếu'] || '',
                  coQuanBanHanh: info['Cơ quan ban hành'] || '',
                  ngayBanHanh: info['Ngày ban hành'] || '',
                  loaiVanBan: info['Loại văn bản'] || '',
                  nguoiKy: info['Người ký'] || '',
                  soVanBan: info['Sổ văn bản'] || '',
                  maDinhDanh: info['Mã định danh'] || '',
                  files: files,
                });
              }
            }
          });
          return docs;
        }
        return extractAllDocuments();
      },
    }).then((results) => {
      const docs = results && results[0] && results[0].result ? results[0].result : [];
      sendResponse({ docs: docs });
    }).catch((err) => {
      console.error('VBDH extract error:', err);
      sendResponse({ docs: [] });
    });
    return true; // async
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
    if (typeof body === 'string') {
      fetchOpts.body = body;
    } else if (body instanceof FormData) {
      fetchOpts.body = body;
      // Let fetch set Content-Type automatically for FormData
      delete reqHeaders['Content-Type'];
    } else {
      fetchOpts.body = JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
    }
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
