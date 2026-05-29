/**
 * content.js - VBDH Assistant v2.1
 * Floating button on qlvbdh.danang.gov.vn
 * Click → inject modal (inject.js) with JWT auth
 */

(function () {
  'use strict';

  if (window.__vbdhContentLoaded) return;
  window.__vbdhContentLoaded = true;

  const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

  // ===== STORAGE HELPERS =====

  function loadStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username', 'vbdh_show_floating'],
        (result) => {
          resolve({
            auth: {
              token: result.vbdh_token || '',
              refreshToken: result.vbdh_refresh_token || '',
              role: result.vbdh_role || '',
              userId: result.vbdh_user_id || '',
              fullName: result.vbdh_full_name || '',
              username: result.vbdh_username || '',
            },
            showFloating: result.vbdh_show_floating !== false,
          });
        }
      );
    });
  }

  // ===== AUTH STATE =====

  let currentAuth = null;

  async function refreshAuth() {
    const stored = await loadStorage();
    currentAuth = stored.auth;
    updateFloatingButton();
    return stored;
  }

  // ===== LISTEN FOR AUTH CHANGES FROM POPUP =====

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'VBDH_AUTH_CHANGED') {
      refreshAuth();
    }
  });

  // ===== FLOATING BUTTON =====

  let floatingButton = null;
  let showFloating = true;

  function createFloatingButton() {
    if (floatingButton) return;

    floatingButton = document.createElement('div');
    floatingButton.id = 'vbdh-floating-btn';
    floatingButton.title = 'Trợ lý văn bản điều hành';
    floatingButton.innerHTML = '📋';
    floatingButton.addEventListener('click', onFloatingClick);

    const style = document.createElement('style');
    style.textContent = `
      #vbdh-floating-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 52px;
        height: 52px;
        background: #1a73e8;
        color: #fff;
        border-radius: 50%;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 999998;
        box-shadow: 0 4px 16px rgba(26,115,232,0.4);
        transition: transform 0.2s, box-shadow 0.2s;
        user-select: none;
      }
      #vbdh-floating-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 24px rgba(26,115,232,0.5);
      }
      #vbdh-floating-btn.vbdh-logged-out {
        background: #9e9e9e;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      }
      #vbdh-floating-btn.vbdh-logged-out:hover {
        box-shadow: 0 6px 24px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(floatingButton);
  }

  function removeFloatingButton() {
    if (floatingButton) {
      floatingButton.remove();
      floatingButton = null;
    }
  }

  function updateFloatingButton() {
    if (!floatingButton) return;
    if (currentAuth && currentAuth.token) {
      floatingButton.classList.remove('vbdh-logged-out');
      floatingButton.title = `Trợ lý VBĐH (${currentAuth.fullName || currentAuth.username})`;
    } else {
      floatingButton.classList.add('vbdh-logged-out');
      floatingButton.title = 'Trợ lý VBĐH — Chưa đăng nhập';
    }
  }

  // ===== CLICK HANDLER =====

  async function onFloatingClick() {
    const stored = await loadStorage();
    currentAuth = stored.auth;

    if (!currentAuth || !currentAuth.token) {
      alert('⚠️ Vui lòng đăng nhập trước.\nMở extension (click icon) → Đăng nhập.');
      return;
    }

    // Tell background.js to inject the modal (in MAIN world)
    chrome.runtime.sendMessage({
      type: 'VBDH_OPEN_PANEL',
      config: { apiBase: DEFAULT_API_BASE },
      auth: currentAuth,
    });
  }

  // ===== INIT =====

  const isQlvbdh = location.hostname.includes('qlvbdh.danang.gov.vn');
  const isTbkl = location.hostname.includes('tbklhoatien.danangsite.com.vn');

  async function init() {
    const stored = await refreshAuth();
    showFloating = stored.showFloating;

    console.log('[VBDH] init() — domain:', location.hostname, '| isQlvbdh:', isQlvbdh, '| isTbkl:', isTbkl, '| hasToken:', !!currentAuth?.token);

    // Floating button + inject panel: only on qlvbdh
    if (isQlvbdh && showFloating) {
      createFloatingButton();
      updateFloatingButton();
    }

    // Chatbot: both qlvbdh and tbklhoatien
    if ((isQlvbdh || isTbkl) && currentAuth && currentAuth.token) {
      initChatbot();
    } else {
      console.log('[VBDH] Chatbot NOT started — isQlvbdh:', isQlvbdh, 'isTbkl:', isTbkl, 'hasToken:', !!currentAuth?.token);
    }
  }

  async function initChatbot() {
    try {
      console.log('[VBDH] initChatbot() — checking status...');
      // Check if chatbot is enabled for this user
      const res = await fetch(`${DEFAULT_API_BASE}/api/v1/chatbot/status`, {
        headers: { 'Authorization': `Bearer ${currentAuth.token}` }
      });
      console.log('[VBDH] chatbot/status response:', res.status);
      const data = await res.json();
      console.log('[VBDH] chatbot/status data:', JSON.stringify(data));
      const chatbotEnabled = data?.data?.active || false;

      if (!chatbotEnabled) {
        console.log('[VBDH] Chatbot disabled by server — exiting');
        return;
      }

      // Check local toggle setting
      const chatbotToggleResult = await new Promise(resolve => {
        chrome.storage.local.get(['vbdh_show_chatbot'], (r) => resolve(r.vbdh_show_chatbot !== false));
      });

      if (!chatbotToggleResult) return;

      // Load chatbot script
      if (!document.getElementById('vbdh-chatbot-script')) {
        const script = document.createElement('script');
        script.id = 'vbdh-chatbot-script';
        script.src = chrome.runtime.getURL('chatbot.js');
        document.documentElement.appendChild(script);
      }

      // Wait for chatbot.js to load then init
      const waitForChatbot = setInterval(() => {
        if (window.__vbdhChatbot) {
          clearInterval(waitForChatbot);
          window.__vbdhChatbot.init({
            apiBase: DEFAULT_API_BASE,
            token: currentAuth.token,
            chatbotEnabled: true,
          });
          // Move floating button up to make room for chatbot button
          if (floatingButton) {
            floatingButton.style.bottom = '88px';
          }
        }
      }, 100);
    } catch (e) {
      console.warn('[VBDH] Chatbot init failed:', e);
    }
  }

  // Listen for toggle changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.vbdh_show_floating && isQlvbdh) {
      showFloating = changes.vbdh_show_floating.newValue !== false;
      if (showFloating) {
        createFloatingButton();
        updateFloatingButton();
      } else {
        removeFloatingButton();
      }
    }
  });

  init();
})();
