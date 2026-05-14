/**
 * Popup - VBDH Assistant
 * Popup chỉ dùng để settings + nút mở modal trên trang
 */

const DEFAULT_API_URL = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';

const state = { config: null };

document.addEventListener('DOMContentLoaded', async () => {
  state.config = await loadConfig();

  document.getElementById('btn-open').addEventListener('click', openModal);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  if (!state.config.apiKey) {
    showSettings();
  }
});

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vbdh_api_url', 'vbdh_api_key'], (result) => {
      resolve({
        apiUrl: result.vbdh_api_url || DEFAULT_API_URL,
        apiKey: result.vbdh_api_key || '',
      });
    });
  });
}

async function openModal() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url?.includes('qlvbdh.danang.gov.vn')) {
    alert('Vui lòng mở trang QLVBDH trước!');
    return;
  }

  // Set config
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (cfg) => { window.__vbdhConfig = cfg; },
    args: [state.config],
  });

  // Inject & toggle modal
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    files: ['inject.js'],
  });

  window.close();
}

function showSettings() {
  document.getElementById('setting-api-url').value = state.config.apiUrl || DEFAULT_API_URL;
  document.getElementById('setting-api-key').value = state.config.apiKey || '';
  document.getElementById('settings').classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
}

async function saveSettings() {
  const apiUrl = document.getElementById('setting-api-url').value.trim() || DEFAULT_API_URL;
  const apiKey = document.getElementById('setting-api-key').value.trim();
  if (!apiKey) { alert('Nhập API Key.'); return; }

  const btn = document.getElementById('btn-save-settings');
  btn.textContent = '⏳ Kiểm tra...';
  btn.disabled = true;

  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.data?.status) throw new Error('Invalid response');

    await new Promise(r => chrome.storage.local.set({ vbdh_api_url: apiUrl, vbdh_api_key: apiKey }, r));
    state.config = { apiUrl, apiKey };
    btn.textContent = '✅ OK';
    setTimeout(() => { btn.textContent = '💾 Lưu'; btn.disabled = false; showMain(); }, 1000);
  } catch (e) {
    alert('Lỗi: ' + e.message);
    btn.textContent = '💾 Lưu'; btn.disabled = false;
  }
}

function showMain() {
  document.getElementById('settings').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
}
