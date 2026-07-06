/**
 * Popup - VBDH Assistant v2.0
 * Supports JWT login, role-based UI, floating button toggle
 */

const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

const state = {
  config: null,
  auth: null,
};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VBDH] popup.js loaded - v2.1.1-fix');

  // Load config and auth state
  const stored = await loadStorage();
  console.log('[VBDH] stored auth:', stored.auth ? 'has token=' + !!stored.auth.token : 'null');
  state.config = stored.config;
  state.auth = stored.auth;

  // Bind elements
  bindEvents();

  // Show appropriate view
  if (state.auth && state.auth.token) {
    showMainView();
  } else {
    showLoginView();
  }
});

// ===== STORAGE =====

function loadStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['vbdh_api_url', 'vbdh_api_key', 'vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username', 'vbdh_show_floating', 'vbdh_show_chatbot'],
      (result) => {
        resolve({
          config: {
            apiBase: result.vbdh_api_url || DEFAULT_API_BASE,
            apiKey: result.vbdh_api_key || '',
          },
          auth: {
            token: result.vbdh_token || '',
            refreshToken: result.vbdh_refresh_token || '',
            role: result.vbdh_role || '',
            userId: result.vbdh_user_id || '',
            fullName: result.vbdh_full_name || '',
            username: result.vbdh_username || '',
          },
          showFloating: result.vbdh_show_floating !== false,
          showChatbot: result.vbdh_show_chatbot !== false,
        });
      }
    );
  });
}

async function saveAuth(data) {
  state.auth = {
    token: data.token,
    refreshToken: data.refreshToken,
    role: data.role,
    userId: data.userId,
    fullName: data.fullName,
    username: data.username,
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({
      vbdh_token: data.token,
      vbdh_refresh_token: data.refreshToken,
      vbdh_role: data.role,
      vbdh_user_id: data.userId,
      vbdh_full_name: data.fullName,
      vbdh_username: data.username,
    }, resolve);
  });
}

async function clearAuth() {
  state.auth = { token: '', refreshToken: '', role: '', userId: '', fullName: '', username: '' };
  return new Promise((resolve) => {
    chrome.storage.local.remove([
      'vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username',
    ], resolve);
  });
}

// ===== VIEW MANAGEMENT =====

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('status-text').textContent = '⚠️ Chưa đăng nhập';
  document.getElementById('status-text').style.color = '#e65100';

  // Focus username
  setTimeout(() => document.getElementById('login-username').focus(), 100);
}

function showMainView() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');

  // Populate user info
  const auth = state.auth;
  document.getElementById('user-name').textContent = auth.fullName || auth.username || '—';

  const roleLabels = {
    'ADMIN': '👑 Quản trị viên',
    'CHIEF': '📋 Chánh văn phòng',
    'DEPUTY': '🎖️ Lãnh đạo',
    'DEPT_HEAD': '🏢 Trưởng phòng',
    'STAFF': '📝 Chuyên viên',
  };
  document.getElementById('user-role').textContent = roleLabels[auth.role] || auth.role;

  // Avatar color based on role
  const avatarColors = { 'ADMIN': '#fff3e0', 'CHIEF': '#f3e5f5', 'DEPUTY': '#fce4ec', 'DEPT_HEAD': '#e8f5e9', 'STAFF': '#e3f2fd' };
  const avatarIcons = { 'ADMIN': '👑', 'CHIEF': '📋', 'DEPUTY': '🎖️', 'DEPT_HEAD': '🏢', 'STAFF': '📝' };
  const avatarEl = document.getElementById('user-avatar');
  avatarEl.style.background = avatarColors[auth.role] || '#e3f2fd';
  avatarEl.textContent = avatarIcons[auth.role] || '👤';

  // Status
  document.getElementById('status-text').textContent = '✅ Đã đăng nhập';
  document.getElementById('status-text').style.color = '#2e7d32';

  const stored = loadStorage();
  stored.then((s) => {
    document.getElementById('toggle-floating').checked = s.showFloating;
    document.getElementById('toggle-chatbot').checked = s.showChatbot;
  });

  // Check if chatbot is enabled for this user and show/hide the toggle
  checkChatbotStatus();
}

// ===== CHATBOT STATUS =====

async function checkChatbotStatus() {
  try {
    const stored = await loadStorage();
    const token = stored.auth?.token;
    if (!token) return;

    const res = await fetch(`${stored.config?.apiBase || DEFAULT_API_BASE}/api/v1/chatbot/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const chatbotEnabled = data?.data?.active || false;

    if (chatbotEnabled) {
      document.getElementById('chatbot-toggle-row').style.display = 'flex';
    }
  } catch (e) {
    // Chatbot not available
  }
}

// ===== EVENTS =====

function bindEvents() {
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-open-panel').addEventListener('click', openPanel);

  // Toggle floating button
  document.getElementById('toggle-floating').addEventListener('change', async (e) => {
    await new Promise(r => chrome.storage.local.set({ vbdh_show_floating: e.target.checked }, r));
    // Notify content script
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('qlvbdh.danang.gov.vn')) {
        chrome.tabs.sendMessage(tab.id, { type: 'VBDH_TOGGLE_FLOATING', show: e.target.checked });
      }
    } catch (err) {
      // Tab may not have content script yet
    }
  });

  // Toggle chatbot
  document.getElementById('toggle-chatbot').addEventListener('change', async (e) => {
    await new Promise(r => chrome.storage.local.set({ vbdh_show_chatbot: e.target.checked }, r));
    // Notify content script to show/hide chatbot (no page reload)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        chrome.tabs.sendMessage(tab.id, { type: 'VBDH_TOGGLE_CHATBOT', show: e.target.checked });
      }
    } catch (err) {
      // Content script may not be ready — fallback to reload
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) chrome.tabs.reload(tab.id);
      } catch (e2) {}
    }
  });

  // Enter key on login form
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
}

// ===== LOGIN =====

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');

  errorEl.classList.add('hidden');

  if (!username || !password) {
    errorEl.textContent = 'Vui lòng nhập tên đăng nhập và mật khẩu.';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Đang đăng nhập...';

  try {
    const apiBase = DEFAULT_API_BASE;
    const res = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      let errMsg = 'Đăng nhập thất bại';
      try {
        const errJson = await res.json();
        errMsg = errJson.message || errJson.error || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const json = await res.json();
    const data = json.data || json; // Handle both { data: {...} } and direct {...}

    if (!data.token) {
      throw new Error('Phản hồi không hợp lệ từ server');
    }

    await saveAuth({
      token: data.token,
      refreshToken: data.refreshToken,
      role: data.role,
      userId: data.userId,
      fullName: data.fullName,
      username: data.username,
    });

    // Clear form
    document.getElementById('login-password').value = '';

    showMainView();

    // Notify content script on QLVBDH tab to show floating button
    try {
      const [tab] = await chrome.tabs.query({ url: 'https://qlvbdh.danang.gov.vn/*' });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'VBDH_AUTH_CHANGED' });
      }
    } catch (e) { /* ignore */ }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔑 Đăng nhập';
  }
}

// ===== LOGOUT =====

async function handleLogout() {
  try {
    const apiBase = DEFAULT_API_BASE;
    await fetch(`${apiBase}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.auth.token,
      },
    });
  } catch (_) {
    // Ignore errors on logout
  }

  await clearAuth();
  showLoginView();

  // Notify content script to remove floating button
  try {
    const [tab] = await chrome.tabs.query({ url: 'https://qlvbdh.danang.gov.vn/*' });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'VBDH_AUTH_CHANGED' });
    }
  } catch (e) { /* ignore */ }
}

// ===== OPEN PANEL =====

async function openPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('qlvbdh.danang.gov.vn')) {
    alert('Vui lòng mở trang QLVBDH (qlvbdh.danang.gov.vn) trước!');
    return;
  }

  // Inject config and auth into page
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (cfg, auth) => {
      window.__vbdhConfig = cfg;
      window.__vbdhAuth = auth;
    },
    args: [state.config, state.auth],
  });

  // Inject the existing modal script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    files: ['inject.js'],
  });

  window.close();
}
