/**
 * Popup Script - VBDH Assistant
 * Điều khiển giao diện popup extension
 */

// API endpoint - thay đổi theo server
const API_BASE = 'http://localhost:8080/api/v1';

document.addEventListener('DOMContentLoaded', async () => {
  const sections = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    results: document.getElementById('results'),
    noEmail: document.getElementById('no-email'),
  };

  // Button events
  document.getElementById('btn-retry').addEventListener('click', () => processEmail());
  document.getElementById('btn-reprocess').addEventListener('click', () => processEmail(true));
  document.getElementById('btn-save').addEventListener('click', () => saveResult());

  // Start processing
  await processEmail();

  /**
   * Main flow: Extract email → Check cache → Process AI → Display
   */
  async function processEmail(forceReprocess = false) {
    showSection('loading');

    try {
      // Step 1: Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('outlook.office.com') && !tab.url.includes('outlook.office365.com') && !tab.url.includes('outlook.live.com')) {
        showSection('noEmail');
        return;
      }

      // Step 2: Extract email content from content script
      const emailData = await chrome.tabs.sendMessage(tab.id, { action: 'extractEmail' });

      if (!emailData.success) {
        showError('Không thể đọc nội dung email. Vui lòng mở email chi tiết.');
        return;
      }

      if (!emailData.subject && !emailData.body) {
        showError('Không tìm thấy nội dung email. Vui lòng mở email chi tiết.');
        return;
      }

      // Step 3: Send to backend API
      const response = await fetch(`${API_BASE}/email/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: emailData.subject,
          sender: emailData.sender,
          sentDate: emailData.sentDate,
          body: emailData.body,
          attachments: emailData.attachments,
          cacheKey: emailData.cacheKey,
          forceReprocess: forceReprocess,
        }),
      });

      if (!response.ok) {
        throw new Error(`Lỗi server: ${response.status}`);
      }

      const result = await response.json();

      // Step 4: Display results
      displayResults(emailData, result);

    } catch (error) {
      showError(error.message);
    }
  }

  /**
   * Hiển thị kết quả
   */
  function displayResults(emailData, result) {
    // Email info
    document.getElementById('email-subject').textContent = emailData.subject || '(Không có tiêu đề)';
    document.getElementById('email-sender').textContent = emailData.sender || '';
    document.getElementById('email-date').textContent = emailData.sentDate || '';

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

    // Save result for later use
    window._currentResult = { emailData, result };

    showSection('results');
  }

  /**
   * Lưu kết quả
   */
  async function saveResult() {
    if (!window._currentResult) return;

    const btn = document.getElementById('btn-save');
    btn.textContent = '⏳ Đang lưu...';
    btn.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/task/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(window._currentResult.result),
      });

      if (response.ok) {
        btn.textContent = '✅ Đã lưu';
        setTimeout(() => {
          btn.textContent = '💾 Lưu';
          btn.disabled = false;
        }, 2000);
      }
    } catch (error) {
      btn.textContent = '💾 Lưu';
      btn.disabled = false;
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
   * Chuyển section hiển thị
   */
  function showSection(name) {
    Object.values(sections).forEach((s) => s.classList.add('hidden'));
    sections[name].classList.remove('hidden');
  }
});
