/**
 * Popup Script - VBDH Assistant
 * 
 * Approach: Popup inject functions vào tab QLVBDH qua chrome.scripting.executeScript
 * Không dùng content_scripts (không inject được trên Chrome mới).
 * 
 * Flow:
 * 1. User click Extension → popup mở
 * 2. Popup inject extractFunction() vào tab → đọc DOM + React state
 * 3. Popup inject fetchFunction(url) → fetch file (same-origin)
 * 4. Popup gửi data lên tbkl-hoatien API
 */

const SERVICE_NAME = 'vbdh-assistant';
const RATE_LIMIT_MS = 1000;

const state = {
  currentResult: null,
  isProcessing: false,
  config: null,
};

document.addEventListener('DOMContentLoaded', async () => {
  state.config = await loadConfig();

  document.getElementById('btn-retry').addEventListener('click', () => processEmail(false));
  document.getElementById('btn-reprocess').addEventListener('click', () => processEmail(true));
  document.getElementById('btn-save').addEventListener('click', saveResult);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', hideSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  if (!state.config.apiUrl || !state.config.apiKey) {
    showSettings();
    return;
  }

  await processEmail(false);
});

// ===== CONFIG =====

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vbdh_api_url', 'vbdh_api_key'], (result) => {
      resolve({
        apiUrl: result.vbdh_api_url || '',
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

  const btn = document.getElementById('btn-save-settings');
  btn.textContent = '⏳ Kiểm tra...';
  btn.disabled = true;

  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { 'X-API-Key': apiKey, 'X-Service-Name': SERVICE_NAME },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data?.status) throw new Error('Response không hợp lệ');

    await new Promise((resolve) => {
      chrome.storage.local.set({ vbdh_api_url: apiUrl, vbdh_api_key: apiKey }, resolve);
    });

    state.config = { apiUrl, apiKey };
    btn.textContent = '✅ Đã lưu';
    setTimeout(() => {
      btn.textContent = '💾 Lưu cài đặt';
      btn.disabled = false;
      processEmail(false);
    }, 1000);
  } catch (error) {
    btn.textContent = '💾 Lưu cài đặt';
    btn.disabled = false;
    alert(`Không kết nối được server: ${error.message}`);
  }
}

// ===== MAIN FLOW =====

async function processEmail(forceReprocess = false) {
  if (state.isProcessing) return;
  if (!state.config.apiUrl || !state.config.apiKey) { showSettings(); return; }
  state.isProcessing = true;

  showSection('loading');
  updateLoadingText('Đang đọc thông tin văn bản...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('qlvbdh.danang.gov.vn')) {
      showSection('noEmail');
      return;
    }

    // ===== BƯỚC 1: Inject function đọc dữ liệu vào tab =====
    updateLoadingText('Đang đọc thông tin văn bản...');

    const extractResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDocumentData,
    });

    const docData = extractResults?.[0]?.result;

    if (!docData || !docData.success) {
      showError(docData?.error || 'Không tìm thấy thông tin văn bản. Vui lòng mở chi tiết 1 văn bản.');
      return;
    }

    console.log('[VBDH] Extracted:', docData);

    // ===== BƯỚC 2: Fetch từng file =====
    const fileBlobs = [];
    const files = docData.files || [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      updateLoadingText(`Đang tải file ${i + 1}/${files.length}: ${file.name}`);

      if (i > 0) await sleep(RATE_LIMIT_MS);

      const fetchResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fetchFileAsBase64,
        args: [file.url],
      });

      const fetchResult = fetchResults?.[0]?.result;

      if (fetchResult?.success) {
        const blob = base64ToBlob(fetchResult.content, file.mimeType);
        fileBlobs.push({ name: file.name, blob });
      } else {
        console.warn('[VBDH] Failed to fetch file:', file.name, fetchResult?.error);
      }
    }

    if (fileBlobs.length === 0) {
      showError('Không tải được file đính kèm nào.');
      return;
    }

    // ===== BƯỚC 3: Upload lên tbkl-hoatien =====
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
    fileBlobs.forEach(f => formData.append('files', f.blob, f.name));

    const uploadResponse = await tbklFetch('/documents/upload', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) throw new Error(`Upload lỗi: HTTP ${uploadResponse.status}`);

    const uploadResult = await uploadResponse.json();
    const results = uploadResult.data?.results || [];
    if (results.length === 0 || !results[0].documentId) throw new Error('Upload thất bại.');

    const documentId = results[0].documentId;

    // ===== BƯỚC 4: AI Extract =====
    updateLoadingText('Đang xử lý AI...');

    let extractResult;
    if (forceReprocess) {
      const res = await tbklFetch(`/documents/${documentId}/re-extract`, { method: 'POST' });
      extractResult = (await res.json()).data;
    } else {
      const res = await tbklFetch(`/documents/${documentId}/extract`, { method: 'POST' });
      extractResult = (await res.json()).data;
    }

    if (extractResult.status === 'processing' || extractResult.status === 'extracting') {
      extractResult = await pollExtractionResult(documentId);
    }

    // ===== BƯỚC 5: Display =====
    displayResults(docData, extractResult, documentId);

  } catch (error) {
    showError(error.message);
  } finally {
    state.isProcessing = false;
  }
}

// ===== FUNCTIONS INJECTED INTO PAGE =====

/**
 * Hàm này chạy TRONG context của trang QLVBDH
 * Đọc DOM + React fiber tree → trả về thông tin văn bản + files
 */
function extractDocumentData() {
  try {
    // Bước 1: Tìm wrapper đang hiển thị chi tiết (có file đính kèm)
    const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
    let activeWrapper = null;

    wrappers.forEach((w) => {
      if (w.offsetHeight > 0 && w.querySelector('.file')) {
        if (w.querySelector('td.bold') && w.querySelector('.file__name')) {
          activeWrapper = w;
        }
      }
    });

    if (!activeWrapper) {
      wrappers.forEach((w) => {
        if (w.offsetHeight > 0 && w.querySelector('.file')) {
          activeWrapper = w;
        }
      });
    }

    if (!activeWrapper) {
      return { success: false, error: 'Không tìm thấy chi tiết văn bản. Vui lòng click mở chi tiết 1 văn bản trước.' };
    }

    // Bước 2: Parse DOM để lấy thông tin
    const info = {};
    const rows = activeWrapper.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        cells.forEach((cell, idx) => {
          if (cell.classList.contains('bold') && idx + 1 < cells.length) {
            const label = cell.textContent.trim();
            const value = cells[idx + 1].textContent.trim();
            if (label && value) {
              info[label] = value;
            }
          }
        });
      }
    });

    // Bước 3: Lấy files từ React fiber (duyệt child nodes)
    let filesData = [];
    const keys = Object.keys(activeWrapper);
    const reactKey = keys.find(k => k.startsWith('__reactFiber$'));

    if (reactKey) {
      let fiber = activeWrapper[reactKey];
      let current = fiber.child?.child?.child;

      // Traverse siblings để tìm files
      let maxSearch = 50;
      let sibling = current;
      while (sibling && maxSearch-- > 0) {
        const p = sibling.memoizedProps;
        if (p && Array.isArray(p.files) && p.files.length > 0 && p.files[0].tenTep) {
          filesData = p.files;
          break;
        }
        if (p && Array.isArray(p.children)) {
          for (const child of p.children) {
            if (child && child.props && Array.isArray(child.props.files) && child.props.files.length > 0) {
              filesData = child.props.files;
              break;
            }
          }
          if (filesData.length > 0) break;
        }
        sibling = sibling.sibling || sibling.child;
      }
    }

    // Bước 4: Build result
    const result = {
      success: true,
      soVanBan: info['Sổ văn bản'] || '',
      soKyHieu: info['Số, ký hiệu VB'] || '',
      ngayBanHanh: info['Ngày ban hành'] || '',
      nguoiKy: info['Người ký'] || '',
      trichYieu: info['Trích yếu'] || '',
      coQuanBanHanh: info['Cơ quan ban hành'] || '',
      loaiVanBan: info['Loại văn bản'] || '',
      maDinhDanh: info['Mã định danh'] || '',
      files: filesData.map(f => ({
        name: f.tenTep,
        url: f.url,
        mimeType: f.kieuTep || 'application/pdf',
      })),
    };

    // Cache key
    const normalizedFiles = result.files
      .map(f => f.name.replace(/(\.signed)+/gi, ''))
      .sort()
      .join(',');
    result.cacheKey = [
      result.maDinhDanh,
      result.soKyHieu,
      result.ngayBanHanh,
      result.coQuanBanHanh,
      normalizedFiles,
    ].join('|||');

    return result;
  } catch (error) {
    return { success: false, error: 'Lỗi đọc dữ liệu: ' + error.message };
  }
}

/**
 * Fetch file trong context của trang (same-origin → cookie tự gửi)
 */
function fetchFileAsBase64(fileUrl) {
  return fetch(fileUrl, {
    method: 'GET',
    credentials: 'same-origin',
  })
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.blob();
    })
    .then(blob => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            success: true,
            content: reader.result.split(',')[1],
            size: blob.size,
          });
        };
        reader.onerror = () => resolve({ success: false, error: 'FileReader error' });
        reader.readAsDataURL(blob);
      });
    })
    .catch(error => ({ success: false, error: error.message }));
}

// ===== TBKL API =====

async function tbklFetch(path, options = {}) {
  return fetch(`${state.config.apiUrl}${path}`, {
    ...options,
    headers: {
      'X-API-Key': state.config.apiKey,
      'X-Service-Name': SERVICE_NAME,
      ...options.headers,
    },
  });
}

async function pollExtractionResult(documentId, maxAttempts = 30, interval = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);
    updateLoadingText(`Đang xử lý AI... (${i + 1}/${maxAttempts})`);
    const res = await tbklFetch(`/documents/${documentId}/result`);
    const json = await res.json();
    const data = json.data;
    if (data.status === 'completed' || data.extractionResult != null) return data;
    if (data.status === 'error') throw new Error('Xử lý AI thất bại.');
  }
  throw new Error('Timeout xử lý AI.');
}

// ===== DISPLAY =====

function displayResults(docData, extractResult, documentId) {
  document.getElementById('email-subject').textContent = docData.trichYieu || '(Không có tiêu đề)';
  document.getElementById('email-sender').textContent = docData.coQuanBanHanh || '';
  document.getElementById('email-date').textContent = docData.ngayBanHanh || '';

  const extraction = extractResult.extractionResult || extractResult.data || {};
  const isCached = extractResult._cached === true;
  document.getElementById('cache-badge').classList.toggle('hidden', !isCached);

  const summary = extraction.summary || extraction.raw || 'Không có tóm tắt';
  document.getElementById('summary').textContent = summary;

  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  const tasks = extraction.tasks || [];
  if (Array.isArray(tasks) && tasks.length > 0) {
    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.textContent = typeof task === 'string' ? task : task.title || JSON.stringify(task);
      taskList.appendChild(li);
    });
  } else {
    taskList.innerHTML = '<li>Không có nhiệm vụ được trích xuất</li>';
  }

  const deptList = document.getElementById('dept-list');
  deptList.innerHTML = '';
  const depts = extraction.departments || [];
  if (Array.isArray(depts) && depts.length > 0) {
    depts.forEach((dept) => {
      const li = document.createElement('li');
      const name = typeof dept === 'string' ? dept : dept.name || JSON.stringify(dept);
      const score = dept.score || '';
      li.innerHTML = `<span class="dept-name">${name}</span>${score ? `<span class="dept-score">${score}%</span>` : ''}`;
      deptList.appendChild(li);
    });
  } else {
    deptList.innerHTML = '<li>Không có gợi ý phòng ban</li>';
  }

  state.currentResult = { docData, extractResult, documentId };
  showSection('results');
}

async function saveResult() {
  if (!state.currentResult) return;
  const btn = document.getElementById('btn-save');
  btn.textContent = '⏳ Đang lưu...';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = '✅ Đã lưu';
    setTimeout(() => { btn.textContent = '💾 Lưu'; btn.disabled = false; }, 2000);
  }, 500);
}

// ===== UTILS =====

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mimeType || 'application/pdf' });
}

function showError(msg) { document.getElementById('error-message').textContent = msg; showSection('error'); }
function updateLoadingText(t) { document.getElementById('loading-text').textContent = t; }
function showSection(name) {
  ['loading', 'error', 'results', 'no-email', 'settings'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(name).classList.remove('hidden');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
