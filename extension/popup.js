/**
 * Popup - VBDH Assistant
 */

const DEFAULT_API_URL = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';
const state = { config: null };

document.addEventListener('DOMContentLoaded', async () => {
  state.config = await loadConfig();

  // Buttons
  document.getElementById('btn-open').addEventListener('click', openModal);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', hideSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Nếu chưa có API Key → hiện settings luôn
  if (!state.config.apiKey) {
    showSettings();
    document.getElementById('btn-cancel-settings').style.display = 'none'; // Ẩn nút Huỷ nếu chưa cấu hình
  } else {
    hideSettings();
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
  if (!state.config.apiKey) {
    showSettings();
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url?.includes('qlvbdh.danang.gov.vn')) {
    alert('Vui lòng mở trang QLVBDH trước!');
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (cfg) => { window.__vbdhConfig = cfg; },
    args: [state.config],
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    files: ['inject.js'],
  });

  window.close();
}

function showSettings() {
  document.getElementById('setting-api-key').value = state.config.apiKey || '';
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('settings').classList.remove('hidden');
}

function hideSettings() {
  document.getElementById('settings').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
  updateStatus();
}

function updateStatus() {
  const el = document.getElementById('status-text');
  if (state.config.apiKey) {
    el.textContent = '✅ Đã kết nối';
    el.style.color = '#2e7d32';
  } else {
    el.textContent = '⚠️ Chưa cấu hình';
    el.style.color = '#e65100';
  }
}

async function saveSettings() {
  const apiKey = document.getElementById('setting-api-key').value.trim();
  if (!apiKey) { alert('Nhập API Key.'); return; }

  const btn = document.getElementById('btn-save-settings');
  btn.textContent = '⏳ Kiểm tra...';
  btn.disabled = true;

  try {
    const apiUrl = state.config.apiUrl || DEFAULT_API_URL;
    const res = await fetch(`${apiUrl}/health`, {
      headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.data?.status) throw new Error('Response không hợp lệ');

    await new Promise(r => chrome.storage.local.set({
      vbdh_api_url: apiUrl,
      vbdh_api_key: apiKey,
    }, r));

    state.config = { apiUrl, apiKey };
    btn.textContent = '✅ Đã lưu';
    setTimeout(() => { btn.textContent = '💾 Lưu & Kiểm tra'; btn.disabled = false; hideSettings(); }, 1000);
  } catch (e) {
    alert('Không kết nối được: ' + e.message);
    btn.textContent = '💾 Lưu & Kiểm tra';
    btn.disabled = false;
  }
}
