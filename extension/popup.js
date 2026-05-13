/**
 * Popup Script - VBDH Assistant
 */

const API_BASE = 'http://localhost:8080/api/v1';

// Quản lý trạng thái
const state = {
  currentResult: null,
  isProcessing: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  // Button events
  document.getElementById('btn-retry').addEventListener('click', () => processEmail(false));
  document.getElementById('btn-reprocess').addEventListener('click', () => processEmail(true));
  document.getElementById('btn-save').addEventListener('click', saveResult);

  // Start
  await processEmail(false);
});

/**
 * Main flow: Extract → Process → Display
 */
async function processEmail(forceReprocess = false) {
  if (state.isProcessing) return;
  state.isProcessing = true;

  showSection('loading');

  try {
    // Step 1: Lấy active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('qlvbdh.danang.gov.vn')) {
      showSection('noEmail');
      return;
    }

    // Step 2: Gửi message đến content script
    // Content script sẽ: đọc React state → fetch files → gọi backend → trả kết quả
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'extractAndProcess',
      forceReprocess: forceReprocess,
    });

    if (!response.success) {
      showError(response.error || 'Có lỗi xảy ra');
      return;
    }

    // Step 3: Hiển thị kết quả
    displayResults(response.data);

  } catch (error) {
    if (error.message.includes('Could not establish connection')) {
      showError('Extension chưa sẵn sàng. Vui lòng tải lại trang và thử lại.');
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
function displayResults(result) {
  // Thông tin văn bản
  document.getElementById('email-subject').textContent = result.subject || '(Không có tiêu đề)';
  document.getElementById('email-sender').textContent = result.coQuanBanHanh || '';
  document.getElementById('email-date').textContent = result.ngayBanHanh || '';

  // Cache badge
  const cacheBadge = document.getElementById('cache-badge');
  cacheBadge.classList.toggle('hidden', !result.fromCache);

  // Summary
  document.getElementById('summary').textContent = result.summary || 'Không có tóm tắt';

  // Tasks
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

  // Department suggestions
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

  // Save state
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
    } else {
      throw new Error('Server error');
    }
  } catch (error) {
    btn.textContent = '❌ Lỗi lưu';
    setTimeout(() => {
      btn.textContent = '💾 Lưu';
      btn.disabled = false;
    }, 2000);
  }
}

/**
 * Hiển thị lỗi
 */
function showError(message) {
  document.getElementById('error-message').textContent = message;
  showSection('error');
}

/**
 * Chuyển section
 */
function showSection(name) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('no-email').classList.add('hidden');
  document.getElementById(name).classList.remove('hidden');
}
