/**
 * Popup Script - VBDH Assistant
 * 
 * Gọi thẳng API của tbkl-hoatien, không cần backend riêng.
 * Xác thực qua API Key (service-to-service).
 * 
 * Flow:
 * 1. Content Script → đọc React state + fetch files
 * 2. Popup → upload files lên tbkl-hoatien
 * 3. Popup → gọi extract → lấy kết quả
 * 4. Popup → hiển thị kết quả
 */

// ===== CONFIG =====
const TBKL_API_BASE = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';
const API_KEY = 'vbdh-ext-sk-2026-hoatien-secure';
const SERVICE_NAME = 'vbdh-assistant';
const RATE_LIMIT_MS = 1000;

// ===== STATE =====
const state = {
  currentResult: null,
  isProcessing: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-retry').addEventListener('click', () => processEmail(false));
  document.getElementById('btn-reprocess').addEventListener('click', () => processEmail(true));
  document.getElementById('btn-save').addEventListener('click', saveResult);

  await processEmail(false);
});

// ===== MAIN FLOW =====

async function processEmail(forceReprocess = false) {
  if (state.isProcessing) return;
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
          // Convert base64 back to File object for FormData upload
          const blob = base64ToBlob(fetchResponse.data.content, file.mimeType);
          fileBlobs.push({ name: file.name, blob });
        }
      }
    }

    // Step 3: Upload files lên tbkl-hoatien
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
      // Không set Content-Type — browser tự set multipart boundary
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload lỗi: HTTP ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    const results = uploadResult.data?.results || [];

    if (results.length === 0 || !results[0].documentId) {
      throw new Error('Upload thất công.');
    }

    const documentId = results[0].documentId;

    // Step 4: Extract hoặc lấy kết quả cache
    updateLoadingText('Đang xử lý AI...');

    let extractResult;

    if (forceReprocess) {
      // Force re-extract
      const reExtractRes = await tbklFetch(`/documents/${documentId}/re-extract`, { method: 'POST' });
      extractResult = (await reExtractRes.json()).data;
    } else {
      // Thử extract (sẽ trả cache nếu đã xử lý)
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
    'X-API-Key': API_KEY,
    'X-Service-Name': SERVICE_NAME,
    ...options.headers,
  };

  return fetch(`${TBKL_API_BASE}${path}`, {
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

  // Parse extraction result
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

  // TODO: Gọi API tạo tasks từ extraction result
  // Hiện tại chỉ hiển thị confirm
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
  ['loading', 'error', 'results', 'no-email'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(name).classList.remove('hidden');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
