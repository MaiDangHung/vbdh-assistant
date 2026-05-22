/**
 * content.js - VBDH Assistant v2.0
 * Content script auto-injected on qlvbdh.danang.gov.vn pages
 * Manages floating button + role-based panels
 *
 * CAN use chrome.* APIs (runs in extension context, not MAIN world)
 */

(function () {
  'use strict';

  const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

  let auth = null;
  let config = null;
  let showFloating = true;
  let floatingButton = null;
  let panelContainer = null;
  let panelOpen = false;

  // ===== INITIALIZATION =====

  async function init() {
    const stored = await loadStorage();
    auth = stored.auth;
    config = stored.config;
    showFloating = stored.showFloating;

    if (auth && auth.token && showFloating) {
      injectFloatingButton();
    }
  }

  init();

  // ===== STORAGE =====

  function loadStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['vbdh_token', 'vbdh_refresh_token', 'vbdh_role', 'vbdh_user_id', 'vbdh_full_name', 'vbdh_username',
         'vbdh_api_url', 'vbdh_api_key', 'vbdh_show_floating'],
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
            config: {
              apiBase: result.vbdh_api_url || DEFAULT_API_BASE,
              apiKey: result.vbdh_api_key || '',
            },
            showFloating: result.vbdh_show_floating !== false,
          });
        }
      );
    });
  }

  // ===== MESSAGE LISTENER (from popup) =====

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'VBDH_TOGGLE_FLOATING') {
      showFloating = message.show;
      if (showFloating && auth && auth.token) {
        injectFloatingButton();
      } else {
        removeFloatingButton();
      }
      sendResponse({ ok: true });
    }
    if (message.type === 'VBDH_AUTH_CHANGED') {
      // Re-read storage when auth changes (login/logout)
      loadStorage().then((stored) => {
        auth = stored.auth;
        config = stored.config;
        showFloating = stored.showFloating;
        if (auth && auth.token && showFloating) {
          injectFloatingButton();
        } else {
          removeFloatingButton();
        }
        sendResponse({ ok: true });
      });
      return true; // async response
    }
  });

  // ===== API HELPER (via background.js) =====

  async function apiRequest(path, options) {
    const opts = options || {};
    const authType = opts.authType || 'jwt';
    const method = opts.method || 'GET';
    const reqBody = opts.body || null;
    const isForm = opts.formData || false;

    // FormData cannot be passed via chrome.runtime.sendMessage (gets serialized)
    // For form uploads, call fetch directly with JWT token from storage
    if (isForm) {
      const apiBase = config.apiBase || DEFAULT_API_BASE;
      const fullUrl = path.startsWith('http') ? path : apiBase + path;
      const headers = {};
      if (auth && auth.token) {
        headers['Authorization'] = 'Bearer ' + auth.token;
      }
      const res = await fetch(fullUrl, { method, headers, body: reqBody });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('json') ? await res.json() : await res.text();
      return { ok: res.ok, status: res.status, data };
    }

    // For JWT auth, use the background service worker for auto-refresh
    if (authType === 'jwt') {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'VBDH_API_REQUEST',
          url: path,
          method: method,
          headers: isForm ? {} : { 'Content-Type': 'application/json' },
          body: reqBody || null,
          authType: 'jwt',
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('No response from background'));
            return;
          }
          if (response.needsLogin) {
            handleSessionExpired();
            reject(new Error('Phiên đăng nhập đã hết hạn'));
            return;
          }
          resolve(response);
        });
      });
    }

    // Fallback: direct JWT fetch (should not reach here normally)
    const apiBase = config.apiBase || DEFAULT_API_BASE;
    const fullUrl = path.startsWith('http') ? path : apiBase + path;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && auth.token) {
      headers['Authorization'] = 'Bearer ' + auth.token;
    }
    const fetchOpts = { method, headers };
    if (reqBody && method !== 'GET') {
      fetchOpts.body = JSON.stringify(reqBody);
    }
    const res = await fetch(fullUrl, fetchOpts);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  function handleSessionExpired() {
    if (panelContainer) {
      panelContainer.remove();
      panelContainer = null;
      panelOpen = false;
    }
    // Reload auth state
    loadStorage().then((stored) => {
      auth = stored.auth;
      if (!auth || !auth.token) {
        removeFloatingButton();
      }
    });
  }

  // ===== FLOATING BUTTON =====

  function injectFloatingButton() {
    if (floatingButton) return; // Already injected

    // Inject styles
    const style = document.createElement('style');
    style.id = 'vbdh-floating-styles';
    style.textContent = getFloatingCSS();
    document.head.appendChild(style);

    // Create button
    floatingButton = document.createElement('div');
    floatingButton.id = 'vbdh-floating-btn';
    floatingButton.title = 'Trợ lý văn bản điều hành';
    floatingButton.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    `;
    floatingButton.addEventListener('click', togglePanel);

    document.body.appendChild(floatingButton);
  }

  function removeFloatingButton() {
    if (floatingButton) {
      floatingButton.remove();
      floatingButton = null;
    }
    if (panelContainer) {
      panelContainer.remove();
      panelContainer = null;
      panelOpen = false;
    }
    const styles = document.getElementById('vbdh-floating-styles');
    if (styles) styles.remove();
  }

  // ===== PANEL TOGGLE =====

  function togglePanel() {
    if (panelOpen && panelContainer) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    if (panelContainer) {
      panelContainer.style.display = 'flex';
      panelOpen = true;
      return;
    }

    // Create panel
    panelContainer = document.createElement('div');
    panelContainer.id = 'vbdh-role-panel';
    panelContainer.innerHTML = buildPanelHTML();

    document.body.appendChild(panelContainer);

    // Close on overlay click
    panelContainer.querySelector('.vbdh-rp-overlay').addEventListener('click', closePanel);
    panelContainer.querySelector('.vbdh-rp-close').addEventListener('click', closePanel);

    panelOpen = true;

    // Load role-specific content
    loadRolePanel();
  }

  function closePanel() {
    if (panelContainer) {
      panelContainer.style.display = 'none';
    }
    panelOpen = false;
  }

  function buildPanelHTML() {
    const roleLabels = {
      'ADMIN': '👑 Quản trị viên',
      'DEPT_HEAD': '🏢 Trưởng phòng',
      'STAFF': '📝 Chuyên viên',
    };
    const roleLabel = roleLabels[auth.role] || auth.role;

    return `
      <div class="vbdh-rp-overlay"></div>
      <div class="vbdh-rp-container">
        <div class="vbdh-rp-header">
          <h3>📋 Trợ lý VBDH <span class="vbdh-rp-role">${roleLabel}</span></h3>
          <button class="vbdh-rp-close" title="Đóng">&times;</button>
        </div>
        <div class="vbdh-rp-body" id="vbdh-rp-body">
          <div class="vbdh-rp-loading">
            <div class="vbdh-rp-spinner"></div>
            <p>Đang tải...</p>
          </div>
        </div>
      </div>
    `;
  }

  // ===== ROLE PANELS =====

  async function loadRolePanel() {
    const body = document.getElementById('vbdh-rp-body');
    if (!body) return;

    try {
      // Reload auth in case it changed
      const stored = await loadStorage();
      auth = stored.auth;

      if (!auth || !auth.token) {
        body.innerHTML = '<div class="vbdh-rp-error">⚠️ Chưa đăng nhập. Vui lòng mở extension để đăng nhập.</div>';
        removeFloatingButton();
        return;
      }

      switch (auth.role) {
        case 'ADMIN':
          await loadAdminPanel(body);
          break;
        case 'DEPT_HEAD':
          await loadDeptHeadPanel(body);
          break;
        case 'STAFF':
          await loadStaffPanel(body);
          break;
        default:
          body.innerHTML = '<div class="vbdh-rp-error">⚠️ Vai trò không được hỗ trợ: ' + escapeHtml(auth.role) + '</div>';
      }
    } catch (err) {
      body.innerHTML = '<div class="vbdh-rp-error">❌ Lỗi: ' + escapeHtml(err.message) + '</div>';
    }
  }

  // ===== ADMIN PANEL =====

  async function loadAdminPanel(body) {
    body.innerHTML = `
      <div class="vbdh-rp-section">
        <div class="vbdh-rp-section-title">📄 Văn bản hiện tại</div>
        <button class="vbdh-rp-btn vbdh-rp-btn-primary" id="vbdh-admin-extract">🔍 Trích xuất nhiệm vụ</button>
        <div id="vbdh-admin-docs"></div>
      </div>
      <div class="vbdh-rp-section">
        <div class="vbdh-rp-section-title">📋 Nhiệm vụ đã tạo</div>
        <div id="vbdh-admin-tasks"><div class="vbdh-rp-loading-sm">Đang tải...</div></div>
      </div>
    `;

    // Bind extract button
    document.getElementById('vbdh-admin-extract').addEventListener('click', handleAdminExtract);

    // Load existing tasks
    loadAdminTasks();
  }

  async function handleAdminExtract() {
    const btn = document.getElementById('vbdh-admin-extract');
    const docsContainer = document.getElementById('vbdh-admin-docs');

    btn.disabled = true;
    btn.textContent = '⏳ Đang trích xuất...';
    docsContainer.innerHTML = '<div class="vbdh-rp-loading-sm">Đang phân tích văn bản trên trang...</div>';

    try {
      // Extract documents from the current QLVBDH page
      // We need to run extraction in MAIN world
      const docs = await extractDocumentsFromPage();

      if (!docs || docs.length === 0) {
        docsContainer.innerHTML = '<div class="vbdh-rp-empty">📭 Không tìm thấy văn bản nào đang mở chi tiết trên trang.</div>';
        btn.disabled = false;
        btn.textContent = '🔍 Trích xuất nhiệm vụ';
        return;
      }

      // Load departments for mapping
      const deptRes = await apiRequest('/api/v1/admin/departments');
      const departments = (deptRes.ok && deptRes.data) ? (deptRes.data.data || deptRes.data) : [];

      let html = '';
      for (let i = 0; i < docs.length; i++) {
        html += buildAdminDocCard(docs[i], i, departments);
      }
      docsContainer.innerHTML = html;

      // Bind task creation buttons
      bindAdminTaskButtons(docs, departments);
    } catch (err) {
      docsContainer.innerHTML = '<div class="vbdh-rp-error">❌ ' + escapeHtml(err.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Trích xuất nhiệm vụ';
    }
  }

  function buildAdminDocCard(doc, docIndex, departments) {
    const title = doc.trichYeu || doc.soKyHieu || 'Văn bản ' + (docIndex + 1);
    const shortTitle = title.length > 60 ? title.substring(0, 60) + '...' : title;

    let deptOptions = '<option value="">-- Chọn phòng ban --</option>';
    // Default department
    deptOptions += '<option value="default">Văn phòng (mặc định)</option>';
    if (Array.isArray(departments)) {
      for (const d of departments) {
        deptOptions += `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
      }
    }

    return `
      <div class="vbdh-rp-card">
        <div class="vbdh-rp-card-title">📄 ${escapeHtml(shortTitle)}</div>
        <div class="vbdh-rp-card-meta">
          ${doc.soKyHieu ? '<span>' + escapeHtml(doc.soKyHieu) + '</span>' : ''}
          ${doc.coQuanBanHanh ? '<span>' + escapeHtml(doc.coQuanBanHanh) + '</span>' : ''}
        </div>
        <div id="vbdh-admin-doc-tasks-${docIndex}">
          <div class="vbdh-rp-loading-sm">Đang xử lý file...</div>
        </div>
      </div>
    `;
  }

  function bindAdminTaskButtons(docs, departments) {
    // For each doc, process files and show extracted tasks
    for (let i = 0; i < docs.length; i++) {
      processAdminDoc(docs[i], i, departments);
    }
  }

  async function processAdminDoc(doc, docIndex, departments) {
    const container = document.getElementById(`vbdh-admin-doc-tasks-${docIndex}`);
    if (!container) return;

    // Process files using existing extraction pipeline (API Key auth)
    let allTasks = [];
    for (const file of doc.files) {
      try {
        const cacheKey = generateCacheKey(doc, file);
        const cacheRes = await apiRequest('/api/v1/ext/documents/check-cache', {
          method: 'POST',
          authType: 'jwt',
          body: { cacheKey },
        });

        let extraction = null;
        let documentId = null;

        if (cacheRes.ok && cacheRes.data && cacheRes.data.data && cacheRes.data.data.exists) {
          documentId = cacheRes.data.data.documentId;
          if (cacheRes.data.data.extractionResult) {
            extraction = cacheRes.data.data.extractionResult;
          }
        }

        if (!documentId) {
          // Upload file
          const blob = await fetch(file.url, { credentials: 'same-origin' }).then(r => r.blob());
          if (!blob) continue;

          const singleDoc = { ...doc, files: [{ name: file.name }] };
          const formData = new FormData();
          formData.append('metadata', JSON.stringify({ ...singleDoc, cacheKey }));
          formData.append('cacheKey', cacheKey);
          formData.append('files', blob, file.name);

          const uploadRes = await apiRequest('/api/v1/ext/documents/upload', {
            method: 'POST',
            authType: 'jwt',
            formData: true,
            body: formData,
          });

          if (uploadRes.ok && uploadRes.data) {
            const results = uploadRes.data.data?.results || uploadRes.data.results || [];
            if (results[0] && results[0].documentId) {
              documentId = results[0].documentId;
            }
          }
        }

        // Poll for extraction result
        if (documentId && !extraction) {
          for (let attempt = 0; attempt < 40; attempt++) {
            await sleep(3000);
            const resultRes = await apiRequest(`/api/v1/ext/documents/${documentId}/result`, { authType: 'jwt' });
            if (resultRes.ok && resultRes.data) {
              const d = resultRes.data.data || resultRes.data;
              if (d.extractionResult && (d.status === 'completed' || d.status === 'extracted')) {
                extraction = d.extractionResult;
                break;
              }
            }
          }
        }

        if (extraction && extraction.tasks) {
          allTasks = allTasks.concat(extraction.tasks.map(t => ({
            ...t,
            _documentId: documentId,
            _docTitle: doc.trichYeu || doc.soKyHieu,
          })));
        }
      } catch (err) {
        console.error('[VBDH] Error processing file:', err);
      }
    }

    // Display tasks with department mapping
    if (allTasks.length === 0) {
      container.innerHTML = '<div class="vbdh-rp-empty">Không có nhiệm vụ được trích xuất.</div>';
      return;
    }

    let html = '<div class="vbdh-rp-task-list">';
    for (let j = 0; j < allTasks.length; j++) {
      const task = allTasks[j];
      const taskTitle = typeof task === 'string' ? task : (task.title || '');
      const taskDept = (typeof task === 'object' && task.department) ? task.department : '';

      // Try to auto-match department
      let matchedDeptId = '';
      if (taskDept && Array.isArray(departments)) {
        for (const d of departments) {
          if (d.name && taskDept.toLowerCase().includes(d.name.toLowerCase())) {
            matchedDeptId = d.id;
            break;
          }
        }
      }

      let deptOptions = '<option value="">-- Chọn phòng ban --</option>';
      deptOptions += '<option value="default"' + (!matchedDeptId ? ' selected' : '') + '>Văn phòng (mặc định)</option>';
      if (Array.isArray(departments)) {
        for (const d of departments) {
          const selected = d.id === matchedDeptId ? ' selected' : '';
          deptOptions += `<option value="${d.id}"${selected}>${escapeHtml(d.name)}</option>`;
        }
      }

      html += `
        <div class="vbdh-rp-task-item">
          <div class="vbdh-rp-task-title">${escapeHtml(taskTitle)}</div>
          ${taskDept ? '<div class="vbdh-rp-task-dept">AI gợi ý: ' + escapeHtml(taskDept) + '</div>' : ''}
          <div class="vbdh-rp-task-actions">
            <select class="vbdh-rp-select" id="vbdh-dept-${docIndex}-${j}">${deptOptions}</select>
            <button class="vbdh-rp-btn vbdh-rp-btn-sm vbdh-rp-btn-success"
                    data-doc-index="${docIndex}" data-task-index="${j}"
                    data-task-title="${escapeHtml(taskTitle)}"
                    data-doc-id="${task._documentId || ''}"
                    onclick="this.closest('.vbdh-rp-container') && false">
              Giao nhiệm vụ
            </button>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind buttons via event delegation
    container.querySelectorAll('.vbdh-rp-btn-success').forEach(btn => {
      btn.addEventListener('click', async function () {
        const parts = this.id || '';
        const docIdx = this.getAttribute('data-doc-index');
        const taskIdx = this.getAttribute('data-task-index');
        const selectEl = document.getElementById(`vbdh-dept-${docIdx}-${taskIdx}`);
        const taskTitle = this.getAttribute('data-task-title');
        const docId = this.getAttribute('data-doc-id');

        if (!selectEl) return;
        const deptValue = selectEl.value;

        this.disabled = true;
        this.textContent = '⏳...';

        try {
          const res = await apiRequest('/api/v1/tasks', {
            method: 'POST',
            body: {
              title: taskTitle,
              description: '',
              priority: 'MEDIUM',
              departmentId: deptValue === 'default' ? null : (deptValue || null),
              documentId: docId || null,
            },
          });

          if (res.ok) {
            this.textContent = '✅ Đã giao';
            this.classList.add('vbdh-rp-btn-done');
          } else {
            throw new Error(res.data?.message || 'Tạo nhiệm vụ thất bại');
          }
        } catch (err) {
          this.textContent = '❌ Lỗi';
          this.title = err.message;
          setTimeout(() => {
            this.textContent = 'Giao nhiệm vụ';
            this.disabled = false;
          }, 2000);
        }
      });
    });
  }

  async function loadAdminTasks() {
    const container = document.getElementById('vbdh-admin-tasks');
    if (!container) return;

    try {
      const res = await apiRequest('/api/v1/tasks?size=20');
      if (!res.ok) throw new Error('Không thể tải nhiệm vụ');

      const page = res.data?.data || res.data;
      const tasks = page?.content || page || [];

      if (!Array.isArray(tasks) || tasks.length === 0) {
        container.innerHTML = '<div class="vbdh-rp-empty">Không có nhiệm vụ nào.</div>';
        return;
      }

      let html = '';
      for (const t of tasks) {
        const statusLabels = {
          'CREATED': '🆕 Mới tạo',
          'ASSIGNED': '👥 Đã giao',
          'IN_PROGRESS': '🔄 Đang xử lý',
          'SUBMITTED': '📤 Đã nộp',
          'DEPT_COMPLETED': '✅ Hoàn thành',
          'COMPLETED': '✅ Hoàn thành',
        };
        html += `
          <div class="vbdh-rp-task-row">
            <div class="vbdh-rp-task-row-title">${escapeHtml(t.title || '—')}</div>
            <div class="vbdh-rp-task-row-meta">
              <span>${statusLabels[t.status] || t.status || '—'}</span>
              ${t.departmentName ? '<span>' + escapeHtml(t.departmentName) + '</span>' : ''}
            </div>
          </div>
        `;
      }
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div class="vbdh-rp-error">❌ ' + escapeHtml(err.message) + '</div>';
    }
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch { return isoStr; }
  }

  async function showTaskHistory(taskId) {
    const overlay = document.createElement('div');
    overlay.id = 'vbdh-history-overlay';
    overlay.innerHTML = `
      <div class="vbdh-rp-overlay" style="z-index:1000001"></div>
      <div class="vbdh-history-modal">
        <div class="vbdh-history-header">
          <h3>📋 Lịch sử nhiệm vụ</h3>
          <button class="vbdh-rp-close" id="vbdh-history-close">&times;</button>
        </div>
        <div class="vbdh-history-body" id="vbdh-history-body">
          <div class="vbdh-rp-loading-sm">Đang tải lịch sử...</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#vbdh-history-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.vbdh-rp-overlay').addEventListener('click', () => overlay.remove());

    const body = document.getElementById('vbdh-history-body');
    try {
      const [progressRes, assignmentsRes, reviewsRes] = await Promise.all([
        apiRequest(`/api/v1/tasks/${taskId}/progress`).catch(() => null),
        apiRequest(`/api/v1/tasks/${taskId}/assignments`).catch(() => null),
        apiRequest(`/api/v1/tasks/${taskId}/reviews`).catch(() => null),
      ]);

      const progressList = (progressRes?.ok ? (progressRes.data?.data || progressRes.data) : []) || [];
      const assignmentsList = (assignmentsRes?.ok ? (assignmentsRes.data?.data || assignmentsRes.data) : []) || [];
      const reviewsList = (reviewsRes?.ok ? (reviewsRes.data?.data || reviewsRes.data) : []) || [];

      let html = '';

      if (assignmentsList.length > 0) {
        html += '<div class="vbdh-history-section"><div class="vbdh-history-section-title">👥 Phân công</div>';
        const statusLabels = { ASSIGNED: 'Đã giao', IN_PROGRESS: 'Đang làm', COMPLETED: 'Hoàn thành', SUBMITTED: 'Đã nộp', REJECTED: 'Từ chối' };
        for (const a of assignmentsList) {
          html += `<div class="vbdh-history-item">
            <span class="vbdh-history-label">${escapeHtml(a.assigneeName || a.departmentName || '—')}</span>
            <span class="vbdh-history-status">${statusLabels[a.status] || a.status || '—'}</span>
            <span class="vbdh-history-time">${formatTime(a.createdAt)}</span>
          </div>`;
        }
        html += '</div>';
      }

      if (progressList.length > 0) {
        html += '<div class="vbdh-history-section"><div class="vbdh-history-section-title">📊 Tiến độ</div>';
        for (const p of progressList) {
          html += `<div class="vbdh-history-item">
            <span class="vbdh-history-label">${escapeHtml(p.userName || p.userFullname || '—')}</span>
            <span class="vbdh-history-progress">${p.percent}%</span>
            ${p.note ? '<span class="vbdh-history-note">' + escapeHtml(p.note) + '</span>' : ''}
            <span class="vbdh-history-time">${formatTime(p.createdAt)}</span>
          </div>`;
        }
        html += '</div>';
      }

      if (reviewsList.length > 0) {
        html += '<div class="vbdh-history-section"><div class="vbdh-history-section-title">📝 Phê duyệt</div>';
        for (const r of reviewsList) {
          const actionLabel = r.action === 'approve' ? '✅ Duyệt' : '❌ Từ chối';
          html += `<div class="vbdh-history-item">
            <span class="vbdh-history-label">${actionLabel}</span>
            ${(r.note || r.reviewNote) ? '<span class="vbdh-history-note">' + escapeHtml(r.note || r.reviewNote) + '</span>' : ''}
            <span class="vbdh-history-time">${formatTime(r.createdAt || r.reviewedAt)}</span>
          </div>`;
        }
        html += '</div>';
      }

      if (!html) html = '<div class="vbdh-rp-empty">Chưa có lịch sử.</div>';
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = '<div class="vbdh-rp-error">❌ ' + escapeHtml(err.message) + '</div>';
    }
  }

  // ===== DEPT HEAD PANEL =====

  async function loadDeptHeadPanel(body) {
    body.innerHTML = `
      <div class="vbdh-rp-section">
        <div class="vbdh-rp-section-title">📋 Nhiệm vụ phòng ban</div>
        <div id="vbdh-dh-tasks"><div class="vbdh-rp-loading-sm">Đang tải...</div></div>
      </div>
      <div class="vbdh-rp-section">
        <div class="vbdh-rp-section-title">👥 Nhân viên phòng</div>
        <div id="vbdh-dh-staff"><div class="vbdh-rp-loading-sm">Đang tải...</div></div>
      </div>
    `;

    try {
      // Load tasks for department (backend auto-filters by RBAC)
      const tasksRes = await apiRequest('/api/v1/tasks?size=50');
      const tasksPage = tasksRes.ok ? (tasksRes.data?.data || tasksRes.data) : null;
      const tasks = tasksPage?.content || (Array.isArray(tasksPage) ? tasksPage : []);

      // Load staff
      const usersRes = await apiRequest('/api/v1/admin/users');
      const usersData = usersRes.ok ? (usersRes.data?.data || usersRes.data) : [];
      const staffList = Array.isArray(usersData) ? usersData : [];

      renderDeptHeadTasks(tasks, staffList);
    } catch (err) {
      document.getElementById('vbdh-dh-tasks').innerHTML =
        '<div class="vbdh-rp-error">❌ ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderDeptHeadTasks(tasks, staffList) {
    const container = document.getElementById('vbdh-dh-tasks');
    const staffContainer = document.getElementById('vbdh-dh-staff');

    if (!tasks || tasks.length === 0) {
      container.innerHTML = '<div class="vbdh-rp-empty">Không có nhiệm vụ nào được giao cho phòng.</div>';
    } else {
      let html = '';
      for (const t of tasks) {
        const statusLabels = {
          'CREATED': '🆕 Mới tạo',
          'ASSIGNED': '👥 Đã giao',
          'IN_PROGRESS': '🔄 Đang xử lý',
          'SUBMITTED': '📤 Đã nộp',
          'DEPT_COMPLETED': '✅ Hoàn thành',
          'COMPLETED': '✅ Hoàn thành',
        };
        const canAssign = t.status === 'CREATED' || t.status === 'ASSIGNED';
        const canComplete = t.status === 'SUBMITTED';

        let assignHtml = '';
        if (canAssign && staffList.length > 0) {
          let checkOptions = '';
          for (const s of staffList) {
            checkOptions += `
              <label class="vbdh-rp-checkbox-label">
                <input type="checkbox" class="vbdh-rp-staff-check" value="${s.id}" data-task-id="${t.id}">
                ${escapeHtml(s.fullName || s.username || '—')}
              </label>
            `;
          }
          assignHtml += `
            <div class="vbdh-rp-assign-row" id="vbdh-assign-${t.id}">
              <div class="vbdh-rp-staff-list">${checkOptions}</div>
              <button class="vbdh-rp-btn vbdh-rp-btn-sm vbdh-rp-btn-primary vbdh-rp-assign-btn" data-task-id="${t.id}">
                👥 Phân công
              </button>
            </div>
          `;
        }

        let completeHtml = '';
        if (canComplete) {
          completeHtml += `
            <button class="vbdh-rp-btn vbdh-rp-btn-sm vbdh-rp-btn-success vbdh-rp-complete-btn" data-task-id="${t.id}">
              ✅ Hoàn thành
            </button>
          `;
        }

        html += `
          <div class="vbdh-rp-task-item">
            <div class="vbdh-rp-task-title">${escapeHtml(t.title || '—')}</div>
            <div class="vbdh-rp-task-row-meta">
              <span>${statusLabels[t.status] || t.status || '—'}</span>
              ${t.progress != null ? '<span>Tiến độ: ' + t.progress + '%</span>' : ''}
            </div>
            ${assignHtml}
            ${completeHtml}
            <button class="vbdh-rp-btn vbdh-rp-btn-sm vbdh-rp-btn-outline vbdh-rp-dh-history-btn" data-task-id="${t.id}" style="margin-top:4px">📋 Lịch sử</button>
          </div>
        `;
      }
      container.innerHTML = html;

      // Bind history buttons for dept head
      container.querySelectorAll('.vbdh-rp-dh-history-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          const taskId = this.getAttribute('data-task-id');
          showTaskHistory(taskId);
        });
      });

      // Bind assign buttons
      container.querySelectorAll('.vbdh-rp-assign-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
          const taskId = this.getAttribute('data-task-id');
          const checked = container.querySelectorAll(`.vbdh-rp-staff-check[data-task-id="${taskId}"]:checked`);
          const staffIds = Array.from(checked).map(c => c.value);

          if (staffIds.length === 0) {
            alert('Vui lòng chọn ít nhất 1 nhân viên.');
            return;
          }

          this.disabled = true;
          this.textContent = '⏳...';

          try {
            const res = await apiRequest(`/api/v1/tasks/${taskId}/assign-dept`, {
              method: 'POST',
              body: { staffIds: staffIds },
            });
            if (res.ok) {
              this.textContent = '✅ Đã phân công';
              this.classList.add('vbdh-rp-btn-done');
            } else {
              throw new Error(res.data?.message || 'Phân công thất bại');
            }
          } catch (err) {
            this.textContent = '❌ ' + err.message;
            setTimeout(() => { this.textContent = '👥 Phân công'; this.disabled = false; }, 2000);
          }
        });
      });

      // Bind complete buttons
      container.querySelectorAll('.vbdh-rp-complete-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
          const taskId = this.getAttribute('data-task-id');
          this.disabled = true;
          this.textContent = '⏳...';

          try {
            const res = await apiRequest(`/api/v1/tasks/${taskId}/dept-complete`, {
              method: 'POST',
              body: { note: 'Hoàn thành bởi trưởng phòng' },
            });
            if (res.ok) {
              this.textContent = '✅ Đã hoàn thành';
              this.classList.add('vbdh-rp-btn-done');
              // Refresh panel after a moment
              setTimeout(() => loadRolePanel(), 1000);
            } else {
              throw new Error(res.data?.message || 'Thao tác thất bại');
            }
          } catch (err) {
            this.textContent = '❌ ' + err.message;
            setTimeout(() => { this.textContent = '✅ Hoàn thành'; this.disabled = false; }, 2000);
          }
        });
      });
    }

    // Staff list
    if (staffList.length === 0) {
      staffContainer.innerHTML = '<div class="vbdh-rp-empty">Không có nhân viên.</div>';
    } else {
      let staffHtml = '<div class="vbdh-rp-staff-grid">';
      for (const s of staffList) {
        staffHtml += `
          <div class="vbdh-rp-staff-card">
            <span class="vbdh-rp-staff-name">${escapeHtml(s.fullName || s.username || '—')}</span>
          </div>
        `;
      }
      staffHtml += '</div>';
      staffContainer.innerHTML = staffHtml;
    }
  }

  // ===== STAFF PANEL =====

  async function loadStaffPanel(body) {
    body.innerHTML = `
      <div class="vbdh-rp-section">
        <div class="vbdh-rp-section-title">📋 Nhiệm vụ của tôi</div>
        <button class="vbdh-rp-btn vbdh-rp-btn-secondary vbdh-rp-btn-sm" id="vbdh-staff-refresh">🔄 Làm mới</button>
        <div id="vbdh-staff-tasks"><div class="vbdh-rp-loading-sm">Đang tải...</div></div>
      </div>
    `;

    document.getElementById('vbdh-staff-refresh').addEventListener('click', loadStaffTasks);

    await loadStaffTasks();
  }

  async function loadStaffTasks() {
    const container = document.getElementById('vbdh-staff-tasks');
    if (!container) return;

    container.innerHTML = '<div class="vbdh-rp-loading-sm">Đang tải...</div>';

    try {
      const res = await apiRequest('/api/v1/tasks?size=50');
      if (!res.ok) throw new Error('Không thể tải nhiệm vụ');

      const page = res.data?.data || res.data;
      const tasks = page?.content || (Array.isArray(page) ? page : []);

      if (tasks.length === 0) {
        container.innerHTML = '<div class="vbdh-rp-empty">Không có nhiệm vụ nào được giao cho bạn.</div>';
        return;
      }

      let html = '';
      for (const t of tasks) {
        const progress = t.progress || 0;
        const isComplete = t.status === 'DEPT_COMPLETED' || t.status === 'COMPLETED';
        const isSubmitted = t.status === 'SUBMITTED';
        const canUpdate = t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
        const progressColor = progress >= 100 ? '#4caf50' : progress >= 50 ? '#ff9800' : '#1a73e8';

        const statusLabels = {
          'CREATED': '🆕 Mới tạo',
          'ASSIGNED': '👥 Đã giao',
          'IN_PROGRESS': '🔄 Đang xử lý',
          'SUBMITTED': '📤 Đã nộp duyệt',
          'DEPT_COMPLETED': '✅ Hoàn thành',
          'COMPLETED': '✅ Hoàn thành',
        };

        let updateHtml = '';
        if (canUpdate) {
          updateHtml = `
            <div class="vbdh-rp-progress-row">
              <input type="range" min="0" max="100" value="${progress}" class="vbdh-rp-slider"
                     id="vbdh-progress-${t.id}">
              <span class="vbdh-rp-progress-value" id="vbdh-progress-val-${t.id}">${progress}%</span>
            </div>
            <div class="vbdh-rp-task-actions">
              <button class="vbdh-rp-btn vbdh-rp-btn-sm vbdh-rp-btn-primary vbdh-rp-update-btn" data-task-id="${t.id}">
                📊 Cập nhật tiến độ
              </button>
            </div>
          `;
        }

        let completedBadge = '';
        if (isComplete || isSubmitted) {
          completedBadge = '<span class="vbdh-rp-badge vbdh-rp-badge-done">✅ Hoàn thành</span>';
        }

        html += `
          <div class="vbdh-rp-task-item ${isComplete ? 'vbdh-rp-task-completed' : ''}">
            <div class="vbdh-rp-task-header">
              <div class="vbdh-rp-task-title">${escapeHtml(t.title || '—')}</div>
              ${completedBadge}
            </div>
            <div class="vbdh-rp-task-row-meta">
              <span>${statusLabels[t.status] || t.status || '—'}</span>
            </div>
            <div class="vbdh-rp-progress-bar">
              <div class="vbdh-rp-progress-fill" style="width:${progress}%;background:${progressColor}"></div>
            </div>
            ${updateHtml}
          </div>
        `;
      }
      container.innerHTML = html;

      // Bind slider value display
      container.querySelectorAll('.vbdh-rp-slider').forEach(slider => {
        slider.addEventListener('input', function () {
          const taskId = this.id.replace('vbdh-progress-', '');
          const valEl = document.getElementById(`vbdh-progress-val-${taskId}`);
          if (valEl) valEl.textContent = this.value + '%';
        });
      });

      // Bind update buttons
      container.querySelectorAll('.vbdh-rp-update-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
          const taskId = this.getAttribute('data-task-id');
          const slider = document.getElementById(`vbdh-progress-${taskId}`);
          if (!slider) return;

          const percent = parseInt(slider.value, 10);
          this.disabled = true;
          this.textContent = '⏳...';

          try {
            const res = await apiRequest(`/api/v1/tasks/${taskId}/progress`, {
              method: 'POST',
              body: { percent: percent, note: '' },
            });
            if (!res.ok) throw new Error(res.data?.message || 'Cập nhật thất bại');

            // If 100%, auto-submit
            if (percent >= 100) {
              const submitRes = await apiRequest(`/api/v1/tasks/${taskId}/submit`, {
                method: 'POST',
                body: { note: 'Hoàn thành nhiệm vụ' },
              });
              if (submitRes.ok) {
                this.textContent = '✅ Đã nộp duyệt';
                this.classList.add('vbdh-rp-btn-done');
                // Refresh after delay
                setTimeout(() => loadStaffTasks(), 1000);
              }
            } else {
              this.textContent = '✅ Đã cập nhật';
              this.classList.add('vbdh-rp-btn-done');
              setTimeout(() => {
                this.textContent = '📊 Cập nhật tiến độ';
                this.disabled = false;
              }, 1500);
            }
          } catch (err) {
            this.textContent = '❌ ' + err.message;
            setTimeout(() => { this.textContent = '📊 Cập nhật tiến độ'; this.disabled = false; }, 2000);
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<div class="vbdh-rp-error">❌ ' + escapeHtml(err.message) + '</div>';
    }
  }

  // ===== DOCUMENT EXTRACTION FROM PAGE =====

  async function extractDocumentsFromPage() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'VBDH_EXTRACT_DOCS' },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.docs) {
            resolve([]);
          } else {
            resolve(response.docs);
          }
        }
      );
    });
  }

  // ===== HELPERS =====

  function generateCacheKey(doc, file) {
    const normalizedFileName = file.name.replace(/(\.signed)+/gi, '');
    return [doc.maDinhDanh, normalizedFileName].join('|||');
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===== FLOATING BUTTON CSS =====

  function getFloatingCSS() {
    return `
      #vbdh-floating-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 52px;
        height: 52px;
        background: linear-gradient(135deg, #1a73e8, #1557b0);
        color: white;
        border-radius: 50%;
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
      #vbdh-floating-btn:active {
        transform: scale(0.95);
      }

      /* Panel */
      #vbdh-role-panel {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      }
      .vbdh-rp-overlay {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.45);
      }
      .vbdh-rp-container {
        position: relative;
        width: 92%;
        max-width: 680px;
        max-height: 85vh;
        background: #fff;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        text-align: left;
      }
      .vbdh-rp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 20px;
        border-bottom: 2px solid #1a73e8;
        flex-shrink: 0;
      }
      .vbdh-rp-header h3 {
        margin: 0;
        font-size: 16px;
        color: #1a73e8;
      }
      .vbdh-rp-role {
        font-size: 12px;
        background: #e3f2fd;
        color: #1565c0;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 8px;
      }
      .vbdh-rp-close {
        background: none;
        border: none;
        font-size: 26px;
        cursor: pointer;
        color: #666;
        padding: 0 6px;
        line-height: 1;
      }
      .vbdh-rp-close:hover {
        color: #333;
        background: #f0f0f0;
        border-radius: 4px;
      }
      .vbdh-rp-body {
        padding: 16px 20px;
        overflow-y: auto;
        flex: 1;
        text-align: left;
      }

      /* Sections */
      .vbdh-rp-section {
        margin-bottom: 16px;
      }
      .vbdh-rp-section-title {
        font-weight: 600;
        font-size: 14px;
        color: #1a73e8;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid #e8e8e8;
      }

      /* Cards */
      .vbdh-rp-card {
        background: #fafbfc;
        border: 1px solid #e2e6ea;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
      }
      .vbdh-rp-card-title {
        font-weight: 600;
        font-size: 13px;
        color: #333;
        margin-bottom: 4px;
      }
      .vbdh-rp-card-meta {
        font-size: 12px;
        color: #888;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }

      /* Tasks */
      .vbdh-rp-task-item {
        background: #fafbfc;
        border: 1px solid #e8e8e8;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        transition: background 0.15s;
      }
      .vbdh-rp-task-item:hover {
        background: #f0f4f8;
      }
      .vbdh-rp-task-completed {
        opacity: 0.7;
        background: #f1f8e9;
        border-color: #c5e1a5;
      }
      .vbdh-rp-task-title {
        font-weight: 600;
        font-size: 13px;
        color: #333;
        margin-bottom: 4px;
      }
      .vbdh-rp-task-dept {
        font-size: 12px;
        color: #1565c0;
        margin-bottom: 6px;
      }
      .vbdh-rp-task-row-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }
      .vbdh-rp-task-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }

      /* Task actions row */
      .vbdh-rp-task-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      /* Progress bar */
      .vbdh-rp-progress-bar {
        width: 100%;
        height: 6px;
        background: #e8e8e8;
        border-radius: 3px;
        overflow: hidden;
        margin-top: 8px;
      }
      .vbdh-rp-progress-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s;
      }

      /* Progress slider row */
      .vbdh-rp-progress-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
      }
      .vbdh-rp-slider {
        flex: 1;
        height: 6px;
        -webkit-appearance: none;
        appearance: none;
        background: #e8e8e8;
        border-radius: 3px;
        outline: none;
      }
      .vbdh-rp-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        background: #1a73e8;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      }
      .vbdh-rp-progress-value {
        font-size: 13px;
        font-weight: 600;
        color: #1a73e8;
        min-width: 40px;
        text-align: right;
      }

      /* Assign row */
      .vbdh-rp-assign-row {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed #e0e0e0;
      }
      .vbdh-rp-staff-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .vbdh-rp-checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #333;
        background: white;
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
      }
      .vbdh-rp-checkbox-label:hover {
        background: #f0f4f8;
      }

      /* Staff grid */
      .vbdh-rp-staff-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .vbdh-rp-staff-card {
        background: white;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
      }
      .vbdh-rp-staff-name {
        color: #333;
      }

      /* Select dropdown */
      .vbdh-rp-select {
        padding: 6px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 12px;
        outline: none;
        background: white;
        max-width: 200px;
      }
      .vbdh-rp-select:focus {
        border-color: #1a73e8;
      }

      /* Buttons */
      .vbdh-rp-btn {
        padding: 8px 14px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .vbdh-rp-btn-sm { padding: 5px 10px; font-size: 12px; }
      .vbdh-rp-btn-primary { background: #1a73e8; color: white; }
      .vbdh-rp-btn-primary:hover { background: #1557b0; }
      .vbdh-rp-btn-primary:disabled { background: #a8c7f0; cursor: not-allowed; }
      .vbdh-rp-btn-secondary { background: #f1f3f4; color: #5f6368; }
      .vbdh-rp-btn-secondary:hover { background: #e8eaed; }
      .vbdh-rp-btn-success { background: #2e7d32; color: white; }
      .vbdh-rp-btn-success:hover { background: #1b5e20; }
      .vbdh-rp-btn-success:disabled { background: #a5d6a7; cursor: not-allowed; }
      .vbdh-rp-btn-done { background: #4caf50 !important; color: white !important; }

      /* Badge */
      .vbdh-rp-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        white-space: nowrap;
      }
      .vbdh-rp-badge-done { background: #e8f5e9; color: #2e7d32; }

      /* Loading / Empty / Error */
      .vbdh-rp-loading, .vbdh-rp-empty { text-align: center; padding: 24px; color: #666; font-size: 13px; }
      .vbdh-rp-loading-sm { text-align: center; padding: 12px; color: #888; font-size: 12px; }
      .vbdh-rp-spinner { width: 32px; height: 32px; border: 3px solid #e8e8e8; border-top-color: #1a73e8; border-radius: 50%; animation: vbdh-rp-spin 0.8s linear infinite; margin: 0 auto 10px; }
      @keyframes vbdh-rp-spin { to { transform: rotate(360deg); } }
      .vbdh-rp-error { color: #c62828; padding: 10px; background: #ffebee; border-radius: 6px; font-size: 13px; }

      /* History Modal */
      .vbdh-history-modal {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 480px; max-height: 70vh; background: white; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 1000002; display: flex; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .vbdh-history-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px 20px; border-bottom: 1px solid #eee;
      }
      .vbdh-history-header h3 { margin: 0; font-size: 16px; color: #333; }
      .vbdh-history-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
      .vbdh-history-section { margin-bottom: 16px; }
      .vbdh-history-section-title { font-size: 13px; font-weight: 700; color: #555; margin-bottom: 8px; text-transform: uppercase; }
      .vbdh-history-item { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
      .vbdh-history-label { font-weight: 500; color: #333; min-width: 100px; }
      .vbdh-history-progress { font-weight: 700; color: #1a73e8; min-width: 40px; }
      .vbdh-history-status { font-size: 12px; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
      .vbdh-history-note { color: #888; flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vbdh-history-time { color: #aaa; font-size: 11px; margin-left: auto; white-space: nowrap; }
      .vbdh-rp-btn-outline { background: white; color: #1a73e8; border: 1px solid #1a73e8; }
      .vbdh-rp-btn-outline:hover { background: #e8f0fe; }
    `;
  }
})();
