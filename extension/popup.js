/**
 * Popup Script - VBDH Assistant
 * 
 * ARCHITECTURE:
 * - Popup → Content Script: extractData (đọc React state)
 * - Popup → Content Script: fetchFile (fetch file, same-origin, không CORS)
 * - Popup → Backend API: analyze (gửi data lên backend, extension context, không CORS)
 * 
 * Flow:
 * 1. Popup yêu cầu Content Script đọc React state
 * 2. Popup yêu cầu Content Script fetch từng file (rate limit 1 req/sec)
 * 3. Popup gửi toàn bộ data lên Backend (1 POST request)
 * 4. Popup hiển thị kết quả
 */

const API_BASE = 'http://localhost:8080/api/v1';
const RATE_LIMIT_MS = 1000; // 1 giây giữa mỗi file fetch

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

/**
 * Main flow
 */
async function processEmail(forceReprocess = false) {
  if (state.isProcessing) return;
  state.isProcessing = false;

  showSection('loading');
  updateLoadingText('Đang đọc thông tin văn bản...');

  try {
    // Step 1: Lấy tab hiện tại
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('qlvbdh.danang.gov.vn')) {
      showSection('noEmail');
      return;
    }

    // Step 2: Content Script đọc React state (0 request)
    const extractResponse = await chrome.tabs.sendMessage(tab.id, {
      action: 'extractData',
    });

    if (!extractResponse.success) {
      showError(extractResponse.error);
      return;
    }

    const docData = extractResponse.data;

    // Step 3: Content Script fetch từng file (rate limit)
    const files = [];
    if (docData.files && docData.files.length > 0) {
      for (let i = 0; i < docData.files.length; i++) {
        const file = docData.files[i];

        updateLoadingText(`Đang tải file ${i + 1}/${docData.files.length}: ${file.name}`);

        // Rate limit
        if (i > 0) {
          await sleep(RATE_LIMIT_MS);
        }

        // Content Script fetch file (same-origin → không CORS)
        const fetchResponse = await chrome.tabs.sendMessage(tab.id, {
          action: 'fetchFile',
          fileUrl: file.url,
        });

        if (fetchResponse.success) {
          files.push({
            name: file.name,
            mimeType: file.mimeType,
            content: fetchResponse.data.content,
            size: fetchResponse.data.size,
          });
        } else {
          files.push({
            name: file.name,
            mimeType: file.mimeType,
            error: fetchResponse.error,
          });
        }
      }
    }

    // Step 4: Gửi lên Backend (Popup context → không bị CORS)
    updateLoadingText('Đang xử lý AI...');

    const payload = {
      subject: docData.trichYieu,
      soVanBan: docData.soVanBan,
      soKyHieu: docData.soKyHieu,
      ngayBanHanh: docData.ngayBanHanh,
      coQuanBanHanh: docData.coQuanBanHanh,
      loaiVanBan: docData.loaiVanBan,
      nguoiKy: docData.nguoiKy,
      body: docData.trichYieu || '',
      files: files,
      cacheKey: docData.cacheKey,
      forceReprocess: forceReprocess,
    };

    const response = await fetch(`${API_BASE}/email/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Lỗi server: ${response.status}`);
    }

    const result = await response.json();

    // Step 5: Hiển thị kết quả
    result.coQuanBanHanh = docData.coQuanBanHanh;
    result.ngayBanHanh = docData.ngayBanHanh;
    displayResults(docData, result);

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

/**
 * Hiển thị kết quả
 */
function displayResults(docData, result) {
  document.getElementById('email-subject').textContent = docData.trichYieu || '(Không có tiêu đề)';
  document.getElementById('email-sender').textContent = docData.coQuanBanHanh || '';
  document.getElementById('email-date').textContent = docData.ngayBanHanh || '';

  const cacheBadge = document.getElementById('cache-badge');
  cacheBadge.classList.toggle('hidden', !result.fromCache);

  document.getElementById('summary').textContent = result.summary || 'Không có tóm tắt';

  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  if (result.tasks && result.tasks.length > 0) {
    result.tasks.forEach((task) => {
      const li = document.createElement('li');
      li.textContent = task;
      taskList.appendChild(li);
    });
  } else {
    taskList.innerHTML = '<li>Không có nhiệm vụ được trích xuất</li>';
  }

  const deptList = document.getElementById('dept-list');
  deptList.innerHTML = '';
  if (result.departments && result.departments.length > 0) {
    result.departments.forEach((dept) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="dept-name">${dept.name}</span>
        <span class="dept-score">${dept.score}%</span>
      `;
      deptList.appendChild(li);
    });
  } else {
    deptList.innerHTML = '<li>Không có gợi ý phòng ban</li>';
  }

  state.currentResult = result;
  showSection('results');
}

/**
 * Lưu kết quả
 */
async function saveResult() {
  if (!state.currentResult) return;

  const btn = document.getElementById('btn-save');
  btn.textContent = '⏳ Đang lưu...';
  btn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/task/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentResult),
    });

    if (response.ok) {
      btn.textContent = '✅ Đã lưu';
      setTimeout(() => {
        btn.textContent = '💾 Lưu';
        btn.disabled = false;
      }, 2000);
    }
  } catch {
    btn.textContent = '❌ Lỗi lưu';
    setTimeout(() => {
      btn.textContent = '💾 Lưu';
      btn.disabled = false;
    }, 2000);
  }
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
