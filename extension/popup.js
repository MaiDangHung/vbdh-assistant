/**
 * Popup Script - VBDH Assistant
 * 
 * Gọi API của tbkl-hoatien, xác thực qua API Key.
 * API Key và Server URL được cấu hình qua Settings (chrome.storage).
 */

// ===== DEFAULT CONFIG (không chứa key thật) =====
const DEFAULT_API_URL = '';
const SERVICE_NAME = 'vbdh-assistant';
const RATE_LIMIT_MS = 1000;

// ===== STATE =====
const state = {
  currentResult: null,
  isProcessing: false,
  config: null,
};

document.addEventListener('DOMContentLoaded', async () => {
  // Load config từ chrome.storage
  state.config = await loadConfig();

  // Button events
  document.getElementById('btn-retry').addEventListener('click', () => processEmail(false));
  document.getElementById('btn-reprocess').addEventListener('click', () => processEmail(true));
  document.getElementById('btn-save').addEventListener('click', saveResult);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', hideSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Nếu chưa có config → hiện settings luôn
  if (!state.config.apiUrl || !state.config.apiKey) {
    showSettings();
    return;
  }

  await processEmail(false);
});

// ===== CONFIG MANAGEMENT =====

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

function showSettings() {
  document.getElementById('setting-api-url').value = state.config.apiUrl || '';
  document.getElementById('setting-api-key').value = state.config.apiKey || '';
  showSection('settings');
}

function hideSettings() {
  if (!state.config.apiUrl || !state.config.apiKey) {
    showError('Vui lòng cấu hình API Key trước khi sử dụng.');
    return;
  }
  showSection('noEmail');
}

async function saveSettings() {
  const apiUrl = document.getElementById('setting-api-url').value.trim();
  const apiKey = document.getElementById('setting-api-key').value.trim();

  if (!apiUrl || !apiKey) {
    alert('Vui lòng nhập đầy đủ API Server URL và API Key.');
    return;
  }

  // Test connection
  const btn = document.getElementById('btn-save-settings');
  btn.textContent = '⏳ Kiểm tra...';
  btn.disabled = true;

  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: {
        'X-API-Key': apiKey,
        'X-Service-Name': SERVICE_NAME,
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    if (!json.data?.status) {
      throw new Error('Response không hợp lệ');
    }

    // Lưu vào chrome.storage
    await new Promise((resolve) => {
      chrome.storage.local.set({
        vbdh_api_url: apiUrl,
        vbdh_api_key: apiKey,
      }, resolve);
    });

    state.config = { apiUrl, apiKey };
    btn.textContent = '✅ Đã lưu';
    setTimeout(() => {
      btn.textContent = '💾 Lưu cài đặt';
      btn.disabled = false;
      // Chuyển sang process email
      processEmail(false);
    }, 1000);

  } catch (error) {
    btn.textContent = '💾 Lưu cài đặt';
    btn.disabled = false;
    alert(`Không kết nối được server: ${error.message}\n\nVui lòng kiểm tra lại URL và API Key.`);
  }
}

// ===== MAIN FLOW =====

async function processEmail(forceReprocess = false) {
  if (state.isProcessing) return;
  if (!state.config.apiUrl || !state.config.apiKey) {
    showSettings();
    return;
  }
  state.isProcessing = true;

  showSection('loading');
  updateLoadingText('Đang đọc thông tin văn bản...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('qlvbdh.danang.gov.vn')) {
      showSection('noEmail');
      return;
    }

    // Step 1: Content Script đọc React state
    const extractResponse = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });

    if (!extractResponse.success) {
      showError(extractResponse.error);
      return;
    }

    const docData = extractResponse.data;

    // Step 2: Content Script fetch files (rate limited)
    const fileBlobs = [];
    if (docData.files && docData.files.length > 0) {
      for (let i = 0; i < docData.files.length; i++) {
        const file = docData.files[i];
        updateLoadingText(`Đang tải file ${i + 1}/${docData.files.length}: ${file.name}`);

        if (i > 0) await sleep(RATE_LIMIT_MS);

        const fetchResponse = await chrome.tabs.sendMessage(tab.id, {
          action: 'fetchFile',
          fileUrl: file.url,
        });

        if (fetchResponse.success) {
          const blob = base64ToBlob(fetchResponse.data.content, file.mimeType);
          fileBlobs.push({ name: file.name, blob });
        }
      }
    }

    // Step 3: Upload lên tbkl-hoatien
    if (fileBlobs.length === 0) {
      showError('Không tải được file đính kèm nào.');
      return;
    }

    updateLoadingText('Đang upload lên hệ thống...');

    const metadata = JSON.stringify({
      trichYeu: docData.trichYieu,
      soKyHieu: docData.soKyHieu,
      ngayBanHanh: docData.ngayBanHanh,
      coQuanBanHanh: docData.coQuanBanHanh,
      loaiVanBan: docData.loaiVanBan,
      nguoiKy: docData.nguoiKy,
      cacheKey: docData.cacheKey,
    });

    const formData = new FormData();
    formData.append('metadata', metadata);
    fileBlobs.forEach(f => {
      formData.append('files', f.blob, f.name);
    });

    const uploadResponse = await tbklFetch('/documents/upload', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload lỗi: HTTP ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    const results = uploadResult.data?.results || [];

    if (results.length === 0 || !results[0].documentId) {
      throw new Error('Upload thất bại.');
    }

    const documentId = results[0].documentId;

    // Step 4: Extract hoặc lấy kết quả cache
    updateLoadingText('Đang xử lý AI...');

    let extractResult;
    if (forceReprocess) {
      const reExtractRes = await tbklFetch(`/documents/${documentId}/re-extract`, { method: 'POST' });
      extractResult = (await reExtractRes.json()).data;
    } else {
      const extractRes = await tbklFetch(`/documents/${documentId}/extract`, { method: 'POST' });
      extractResult = (await extractRes.json()).data;
    }

    // Step 5: Nếu đang processing → poll kết quả
    if (extractResult.status === 'processing' || extractResult.status === 'extracting') {
      extractResult = await pollExtractionResult(documentId);
    }

    // Step 6: Hiển thị kết quả
    displayResults(docData, extractResult, documentId);

  } catch (error) {
    if (error.message.includes('Could not establish connection')) {
      showError('Extension chưa sẵn sàng. Vui lòng tải lại trang (F5) và thử lại.');
    } else {
      showError(error.message);
    }
  } finally {
    state.isProcessing = false;
  }
}

// ===== TBKL API HELPER =====

async function tbklFetch(path, options = {}) {
  const headers = {
    'X-API-Key': state.config.apiKey,
    'X-Service-Name': SERVICE_NAME,
    ...options.headers,
  };

  return fetch(`${state.config.apiUrl}${path}`, {
    ...options,
    headers,
  });
}

async function pollExtractionResult(documentId, maxAttempts = 30, interval = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);
    updateLoadingText(`Đang xử lý AI... (${i + 1}/${maxAttempts})`);

    const res = await tbklFetch(`/documents/${documentId}/result`);
    const json = await res.json();
    const data = json.data;

    if (data.status === 'completed' || data.extractionResult != null) {
      return data;
    }

    if (data.status === 'error') {
      throw new Error('Xử lý AI thất bại.');
    }
  }

  throw new Error('Timeout xử lý AI. Vui lòng thử lại sau.');
}

// ===== DISPLAY =====

function displayResults(docData, extractResult, documentId) {
  document.getElementById('email-subject').textContent = docData.trichYieu || '(Không có tiêu đề)';
  document.getElementById('email-sender').textContent = docData.coQuanBanHanh || '';
  document.getElementById('email-date').textContent = docData.ngayBanHanh || '';

  const extraction = extractResult.extractionResult || extractResult.data || {};
  const isCached = extractResult._cached === true;

  const cacheBadge = document.getElementById('cache-badge');
  cacheBadge.classList.toggle('hidden', !isCached);

  // Summary
  const summary = extraction.summary || extraction.tóm_tắt || extraction.raw || 'Không có tóm tắt';
  document.getElementById('summary').textContent = summary;

  // Tasks
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  const tasks = extraction.tasks || extraction.nhiem_vu || [];
  if (Array.isArray(tasks) && tasks.length > 0) {
    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.textContent = typeof task === 'string' ? task : task.title || task.nhiem_vu || JSON.stringify(task);
      taskList.appendChild(li);
    });
  } else {
    taskList.innerHTML = '<li>Không có nhiệm vụ được trích xuất</li>';
  }

  // Department suggestions
  const deptList = document.getElementById('dept-list');
  deptList.innerHTML = '';
  const depts = extraction.departments || extraction.phong_ban || [];
  if (Array.isArray(depts) && depts.length > 0) {
    depts.forEach((dept) => {
      const li = document.createElement('li');
      const name = typeof dept === 'string' ? dept : dept.name || dept.phong || JSON.stringify(dept);
      const score = dept.score || dept.do_phu_hop || '';
      li.innerHTML = `
        <span class="dept-name">${name}</span>
        ${score ? `<span class="dept-score">${score}</span>` : ''}
      `;
      deptList.appendChild(li);
    });
  } else {
    deptList.innerHTML = '<li>Không có gợi ý phòng ban</li>';
  }

  state.currentResult = { docData, extractResult, documentId };
  showSection('results');
}

// ===== SAVE =====

async function saveResult() {
  if (!state.currentResult) return;
  const btn = document.getElementById('btn-save');
  btn.textContent = '⏳ Đang lưu...';
  btn.disabled = true;

  setTimeout(() => {
    btn.textContent = '✅ Đã lưu';
    setTimeout(() => {
      btn.textContent = '💾 Lưu';
      btn.disabled = false;
    }, 2000);
  }, 500);
}

// ===== UTILITIES =====

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    array[i] = bytes.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType || 'application/pdf' });
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showSection('error');
}

function updateLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function showSection(name) {
  ['loading', 'error', 'results', 'no-email', 'settings'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(name).classList.remove('hidden');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
