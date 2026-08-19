/**
 * inject.js - Chạy trong MAIN world của trang QLVBDH
 * 
 * 2 chế độ theo role:
 * - ADMIN/CHIEF/DEPT_HEAD: Tab Trích xuất (accordion cũ) + Tab Nhiệm vụ (tạo/giao)
 * - STAFF: Chỉ Tab Nhiệm vụ (danh sách + actions)
 *
 * KHÔNG dùng chrome.* API ở đây!
 * Dùng window.__vbdhAuth cho JWT auth.
 */

(function () {
  'use strict';

  const DEFAULT_API_URL = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';
  const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

  const auth = window.__vbdhAuth || {};
  const role = (auth.role || '').toUpperCase();
  const isAdminOrLeader = role === 'ADMIN' || role === 'CHIEF' || role === 'DEPUTY' || role === 'DEPT_HEAD';
  const isChiefLike = role === 'ADMIN' || role === 'CHIEF' || role === 'DEPUTY';
  const isDeptHead = role === 'DEPT_HEAD';
  const isStaff = role === 'STAFF';

  // State objects (must be declared before entry point)
  const extractState = { tasks: [], departments: [], docs: [] };

  // Entry point
  toggleVbdhModal();

  // ===== AUTH HELPERS =====

  function getAuthHeaders() {
    const a = window.__vbdhAuth;
    const headers = { 'X-Service-Name': 'vbdh-assistant' };
    if (a && a.token) {
      headers['Authorization'] = 'Bearer ' + a.token;
    }
    return headers;
  }

  function getApiUrl() { return DEFAULT_API_URL; }
  function getApiBase() { return DEFAULT_API_BASE; }

  // ===== FETCH WITH AUTO TOKEN REFRESH =====
  // inject.js runs in MAIN world — NO access to chrome.runtime.
  // We use window.postMessage to ask content.js (ISOLATED world) to refresh token.
  // content.js bridges to background.js which does the actual refresh.

  async function refreshJwtToken() {
    return new Promise((resolve) => {
      const reqId = 'refresh_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const handler = (event) => {
        if (event.source !== window) return;
        if (event.data.type === 'VBDH_TOKEN_REFRESHED' && event.data.reqId === reqId) {
          window.removeEventListener('message', handler);
          if (event.data.ok && event.data.token) {
            // Update auth state
            if (window.__vbdhAuth) {
              window.__vbdhAuth.token = event.data.token;
            }
            resolve(true);
          } else {
            resolve(false);
          }
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'VBDH_REFRESH_TOKEN_REQ', reqId }, '*');
      // Timeout after 10s
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(false);
      }, 10000);
    });
  }

  async function fetchWithRefresh(url, options) {
    let res = await fetch(url, options);
    if (res.status === 401) {
      // Try to refresh token via content.js → background.js
      const refreshed = await refreshJwtToken();
      if (refreshed) {
        // Rebuild headers with new token and retry
        const newHeaders = getAuthHeaders();
        if (options && options.headers) {
          // Merge — preserve Content-Type etc, override Authorization
          const merged = { ...options.headers };
          // Strip old auth headers
          delete merged['Authorization'];
          delete merged['authorization'];
          // Add fresh ones from getAuthHeaders()
          Object.assign(merged, newHeaders);
          options.headers = merged;
        } else {
          options = options || {};
          options.headers = newHeaders;
        }
        res = await fetch(url, options);
      }
    }
    return res;
  }

  // ===== TOGGLE MODAL =====

  function toggleVbdhModal() {
    const existingModal = document.getElementById('vbdh-assistant-modal');
    if (existingModal) {
      const willShow = existingModal.style.display === 'none';
      existingModal.style.display = willShow ? 'flex' : 'none';
      document.body.style.overflow = willShow ? 'hidden' : '';
      if (willShow) {
        // Switch to tasks tab if not admin
        if (!isAdminOrLeader) {
          switchTab('tasks');
        } else {
          window.__vbdhRefresh && window.__vbdhRefresh();
        }
      }
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'vbdh-assistant-modal';

    let tabsHtml = '';
    if (isAdminOrLeader) {
      const docTab = (role === 'CHIEF' || role === 'ADMIN')
        ? `<button class="vbdh-tab" data-tab="documents" id="vbdh-tab-documents">📂 Văn bản</button>`
        : '';
      tabsHtml = `
        <div class="vbdh-tabs">
          <button class="vbdh-tab active" data-tab="extract" id="vbdh-tab-extract">📄 Trích xuất</button>
          <button class="vbdh-tab" data-tab="tasks" id="vbdh-tab-tasks">📋 Nhiệm vụ</button>
          ${docTab}
        </div>`;
    }

    modal.innerHTML = `
      <div class="vbdh-overlay"></div>
      <div class="vbdh-container">
        <div class="vbdh-header">
          <h2>📋 Trợ lý văn bản điều hành <span class="vbdh-role-badge vbdh-role-${role.toLowerCase()}">${getRoleLabel(role)}</span></h2>
          <button class="vbdh-close" title="Đóng">&times;</button>
        </div>
        ${tabsHtml}
        <div class="vbdh-body" id="vbdh-body">
          <div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang tải...</p></div>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = getVbdhCSS();
    modal.appendChild(style);

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const closeModal = () => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    };

    modal.querySelector('.vbdh-close').onclick = closeModal;
    modal.querySelector('.vbdh-overlay').onclick = closeModal;

    // Bind tabs
    modal.querySelectorAll('.vbdh-tab').forEach(tab => {
      tab.onclick = () => switchTab(tab.dataset.tab);
    });

    // Show default view
    if (isAdminOrLeader) {
      window.__vbdhRefresh = () => processAllDocuments(modal);
      window.__vbdhRefresh();
    } else {
      switchTab('tasks');
    }
  }

  function getRoleLabel(r) {
    const labels = { CHIEF: 'Chánh VP', DEPUTY: 'Lãnh đạo', ADMIN: 'Chánh VP', DEPT_HEAD: 'Trưởng phòng', STAFF: 'Chuyên viên' };
    console.log('[VBDH] Current role from auth:', r);
    return labels[r] || r;
  }

  // Get current user's assignment progress for a task (not task aggregate)
  function getMyAssignmentProgress(t) {
    if (!auth.userId || !t.assignees || !Array.isArray(t.assignees) || t.assignees.length === 0) return t.progress || 0;
    const mine = t.assignees.find(a => String(a.userId) === String(auth.userId));
    if (mine && mine.progress != null) return mine.progress;
    return t.progress || 0;
  }

  function switchTab(tabName) {
    // STAFF can only access tasks tab
    if (isStaff && tabName !== 'tasks') tabName = 'tasks';
    const body = document.getElementById('vbdh-body');
    if (!body) return;

    // Update tab buttons
    document.querySelectorAll('.vbdh-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    if (tabName === 'extract') {
      // Only auto-process if not already done
      if (!body.querySelector('.vbdh-doc-header')) {
        window.__vbdhRefresh && window.__vbdhRefresh();
      }
    } else if (tabName === 'tasks') {
      loadTasksPanel(body);
    } else if (tabName === 'documents') {
      loadDocumentsPanel(body);
    }
  }

  // ===================================================================
  // TASK MANAGEMENT PANEL
  // ===================================================================

  // Download file văn bản qua blob kèm JWT (link trực tiếp sẽ 403 vì thiếu Authorization)
  async function downloadDocFile(docId, fileName) {
    try {
      const res = await fetchWithRefresh(getApiBase() + `/api/v1/documents/${docId}/download`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || `document-${docId}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('❌ Tải file thất bại: ' + (e.message || e)); }
  }

  async function apiGet(path) {
    const res = await fetchWithRefresh(getApiBase() + path, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetchWithRefresh(getApiBase() + path, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'HTTP ' + res.status);
    }
    return res.json();
  }

  async function apiPut(path, body) {
    const res = await fetchWithRefresh(getApiBase() + path, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiDelete(path) {
    const res = await fetchWithRefresh(getApiBase() + path, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  let taskState = {
    tasks: [],
    departments: [],
    users: [],
    statusFilter: '',
    page: 0,
    pageSize: 10,
    total: 0,
    loading: false,
  };

  async function loadTasksPanel(body) {
    body.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang tải nhiệm vụ...</p></div>';

    try {
      // Load departments + users in parallel
      const [deptRes, userRes] = await Promise.all([
        apiGet('/api/v1/admin/departments').catch(() => ({ data: { data: [] } })),
        apiGet('/api/v1/admin/officers').catch(() => ({ data: { data: [] } })),
      ]);
      taskState.departments = deptRes.data?.data || deptRes.data || [];
      taskState.users = userRes.data?.data || userRes.data || [];
    } catch (e) {
      console.warn('[VBDH] Failed to load departments/users:', e);
    }

    renderTasksPanel(body);
    loadTasks(body);
  }

  function renderTasksPanel(body) {
    const statusTabs = getStatusTabs();
    const canCreate = isAdminOrLeader;

    let html = '';

    // Top actions
    if (canCreate) {
      html += '<div class="vbdh-task-top-bar">';
      html += '<button class="vbdh-btn vbdh-btn-primary" id="vbdh-btn-create-task">➕ Tạo nhiệm vụ mới</button>';
      html += '</div>';
    }

    // Status tabs
    html += '<div class="vbdh-status-tabs">';
    for (const tab of statusTabs) {
      const active = tab.key === taskState.statusFilter ? ' active' : '';
      html += `<button class="vbdh-status-tab${active}" data-status="${tab.key}">${tab.label}</button>`;
    }
    html += '</div>';

    // Task table
    html += '<div id="vbdh-task-table-wrap"><div class="vbdh-loading"><div class="vbdh-spinner"></div></div></div>';

    body.innerHTML = html;

    // Bind events
    if (canCreate) {
      document.getElementById('vbdh-btn-create-task').onclick = () => openCreateTaskModal(body);
    }
    body.querySelectorAll('.vbdh-status-tab').forEach(btn => {
      btn.onclick = () => {
        taskState.statusFilter = btn.dataset.status;
        taskState.page = 0;
        renderTasksPanel(body);
        loadTasks(body);
      };
    });
  }

  function getStatusTabs() {
    if (isAdminOrLeader) {
      return [
        { key: '', label: '📋 Tất cả' },
        { key: 'dept_assigned', label: '👥 Đã giao NV' },
        { key: 'in_progress', label: '🔄 Đang thực hiện' },
        { key: 'pending_review', label: '⏳ Chờ duyệt' },
        { key: 'dept_rejected', label: '⚠️ Bị trả lại' },
        { key: 'completed', label: '✅ Hoàn thành' },
      ];
    }
    if (isDeptHead) {
      return [
        { key: '', label: '📋 Tất cả' },
        { key: 'dept_assigned', label: '👥 Đã giao NV' },
        { key: 'dept_assigned', label: '👥 Đã giao NV' },
        { key: 'pending_review', label: '⏳ Chờ duyệt' },
        { key: 'dept_rejected', label: '⚠️ Bị trả lại' },
        { key: 'completed', label: '✅ Hoàn thành' },
      ];
    }
    // STAFF
    return [
      { key: '', label: '📋 Tất cả' },
      { key: 'dept_assigned', label: '📥 Đã nhận' },
      { key: 'in_progress', label: '🔄 Đang làm' },
      { key: 'pending_review', label: '⏳ Chờ duyệt' },
      { key: 'dept_rejected', label: '⚠️ Cần sửa lại' },
      { key: 'completed', label: '✅ Hoàn thành' },
    ];
  }

  async function loadTasks(body) {
    const wrap = document.getElementById('vbdh-task-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div></div>';

    try {
      const params = new URLSearchParams({
        page: taskState.page,
        size: taskState.pageSize,
      });
      if (taskState.statusFilter) params.set('status', taskState.statusFilter);

      const res = await apiGet('/api/v1/tasks?' + params.toString());
      const pageData = res.data?.data || res.data || {};
      taskState.tasks = pageData.content || (Array.isArray(pageData) ? pageData : []);
      taskState.total = pageData.totalElements || taskState.tasks.length;

      renderTaskTable(wrap);
    } catch (e) {
      wrap.innerHTML = `<div class="vbdh-error">❌ Lỗi tải nhiệm vụ: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderTaskTable(wrap) {
    const tasks = taskState.tasks;
    if (tasks.length === 0) {
      wrap.innerHTML = '<div class="vbdh-empty">📭 Không có nhiệm vụ nào.</div>';
      return;
    }

    let html = '<table class="vbdh-table"><thead><tr>';
    html += '<th style="width:30%">Tên nhiệm vụ</th>';
    html += '<th style="width:120px">Phòng ban</th>';
    html += '<th style="width:90px">Ưu tiên</th>';
    html += '<th style="width:100px">Hạn</th>';
    html += '<th style="width:120px">Trạng thái</th>';
    html += '<th style="width:130px">Người xử lý</th>';
    html += '<th style="width:120px">Tiến độ</th>';
    html += '<th style="width:240px">Thao tác</th>';
    html += '</tr></thead><tbody>';

    for (const t of tasks) {
      html += '<tr>';

      // Title
      html += `<td><b>${escapeHtml(t.title || '')}</b></td>`;

      // Department
      html += `<td>${escapeHtml(t.assignedDepartmentName || '-')}</td>`;

      // Priority
      const pColor = { CAO: '#e53935', HIGH: '#e53935', BINH_THUONG: '#1a73e8', NORMAL: '#1a73e8', THAP: '#999' };
      const pLabel = { CAO: 'Cao', HIGH: 'Cao', BINH_THUONG: 'BT', NORMAL: 'BT', THAP: 'Thấp' };
      const pv = (t.priority || '').toUpperCase();
      html += `<td><span class="vbdh-priority" style="color:${pColor[pv] || '#999'}">${pLabel[pv] || pv || '-'}</span></td>`;

      // Deadline
      const dl = t.deadline ? formatDateShort(t.deadline) : '-';
      html += `<td>${dl}</td>`;

      // Status
      const sc = { assigned: '#1890ff', dept_assigned: '#13c2c2', in_progress: '#fa8c16', pending_review: '#faad14', dept_rejected: '#ff4d4f', completed: '#52c41a', cancelled: '#999' };
      const sl = { assigned: 'Chờ xử lý', dept_assigned: 'Đã giao NV', in_progress: 'Đang làm', pending_review: 'Chờ duyệt', dept_rejected: 'Bị trả lại', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
      const sv = t.status || '';
      html += `<td><span class="vbdh-status-tag" style="background:${sc[sv] || '#999'}20;color:${sc[sv] || '#999'}">${sl[sv] || sv}</span></td>`;

      // Assignees
      html += '<td>';
      if (t.assignees && t.assignees.length > 0) {
        html += t.assignees.slice(0, 2).map(a => escapeHtml(a.userFullName || a.userName || 'N/A')).join(', ');
        if (t.totalAssignees > 2) html += ` +${t.totalAssignees - 2}`;
      } else {
        html += '<span style="color:#bbb">Chưa phân công</span>';
      }
      html += '</td>';

      // Progress
      const prog = t.progress || 0;
      const progColor = prog >= 100 ? '#52c41a' : prog >= 70 ? '#1890ff' : prog >= 30 ? '#faad14' : '#ff4d4f';
      html += `<td><div class="vbdh-progress-bar"><div class="vbdh-progress-fill" style="width:${prog}%;background:${progColor}"></div></div><span class="vbdh-progress-text">${prog}%</span></td>`;

      // Actions
      html += '<td class="vbdh-actions">';
      html += getTaskActionButtons(t);
      html += '</td>';

      html += '</tr>';
    }

    html += '</tbody></table>';

    // Pagination
    if (taskState.total > taskState.pageSize) {
      const totalPages = Math.ceil(taskState.total / taskState.pageSize);
      html += '<div class="vbdh-pagination">';
      html += `<span>Trang ${taskState.page + 1}/${totalPages} · ${taskState.total} nhiệm vụ</span>`;
      if (taskState.page > 0) html += `<button class="vbdh-btn vbdh-btn-sm" onclick="window.__vbdhTaskPage(${taskState.page - 1})">◀ Trước</button>`;
      if (taskState.page < totalPages - 1) html += `<button class="vbdh-btn vbdh-btn-sm" onclick="window.__vbdhTaskPage(${taskState.page + 1})">Sau ▶</button>`;
      html += '</div>';
    }

    wrap.innerHTML = html;

    // Bind action buttons
    bindTaskActions(wrap);
  }

  function getTaskActionButtons(t) {
    let btns = '';
    const sv = t.status || '';

    // Chi tiết — all
    btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="detail" data-id="${t.id}">👁 Chi tiết</button>`;

    // [REMOVED] Phân công NV — task giờ auto-giao mọi STAFF trong phòng khi tạo

    // Duyệt (CVP/Lãnh đạo) — ADMIN/CHIEF/DEPUTY, status = pending_review
    if (isChiefLike && sv === 'pending_review') {
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#722ed1;color:#fff" data-action="review" data-id="${t.id}">✅ Duyệt</button>`;
    }

    // Tiến độ — STAFF/DEPT_HEAD, status in progress
    if ((isStaff || isDeptHead) && ['dept_assigned', 'in_progress', 'dept_rejected'].includes(sv)) {
      const myPct = getMyAssignmentProgress(t);
      btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="progress" data-id="${t.id}" data-pct="${myPct}">📊 Tiến độ</button>`;
    }

    // Gửi duyệt — STAFF/DEPT_HEAD, progress = 100
    if ((isStaff || isDeptHead) && ['dept_assigned', 'in_progress', 'dept_rejected'].includes(sv)) {
      const myPct = getMyAssignmentProgress(t);
      const canSubmit = myPct >= 100;
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#fa8c16;color:#fff" data-action="submit" data-id="${t.id}" ${canSubmit ? '' : 'disabled title="Tiến độ phải đạt 100%"'}>📤 Gửi duyệt</button>`;
    }

    // [REMOVED] ADMIN direct complete (bypass CVP) — mọi task phải qua CVP duyệt

    // Hoàn thành — DEPT_HEAD (gửi duyệt)
    if (isDeptHead && ['dept_assigned', 'in_progress', 'dept_rejected'].includes(sv)) {
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#52c41a;color:#fff" data-action="dept-complete" data-id="${t.id}">✔️ Hoàn thành</button>`;
    }

    // Tải file gốc — all, has documentId
    if (t.documentId) {
      btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="download" data-doc-id="${t.documentId}">📎 Tải file</button>`;
    }

    // Lịch sử — all
    btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="history" data-id="${t.id}">📜 Lịch sử</button>`;

    // Sửa — ADMIN, CHIEF, DEPUTY, DEPT_HEAD
    if (isChiefLike || isDeptHead) {
      btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="edit" data-id="${t.id}">✏️ Sửa</button>`;
    }

    // Xóa — ADMIN only
    if (role === 'ADMIN') {
      btns += `<button class="vbdh-btn vbdh-btn-sm vbdh-btn-danger" data-action="delete" data-id="${t.id}">🗑️</button>`;
    }

    return btns;
  }

  function bindTaskActions(wrap) {
    wrap.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        handleTaskAction(action, id, btn);
      };
    });
  }

  async function handleTaskAction(action, id, btn) {
    const body = document.getElementById('vbdh-body');

    switch (action) {
      case 'detail':
        openDetailModal(id);
        break;
      case 'edit':
        openEditModal(id);
        break;
      case 'assign':
        openAssignModal(id, btn.dataset.dept);
        break;
      case 'review':
        openReviewModal(id);
        break;
      case 'progress':
        openProgressModal(id, parseInt(btn.dataset.pct) || 0);
        break;
      case 'submit':
        if (!confirm('Gửi yêu cầu duyệt nhiệm vụ này?')) return;
        try {
          await apiPost(`/api/v1/tasks/${id}/submit`, { note: '' });
          alert('✅ Đã gửi yêu cầu duyệt');
          loadTasks(body);
        } catch (e) { alert('❌ ' + e.message); }
        break;
      case 'dept-complete':
        if (!confirm('Hoàn thành và gửi duyệt?')) return;
        try {
          await apiPost(`/api/v1/tasks/${id}/dept-complete`, { note: '' });
          alert('✅ Đã hoàn thành, chờ CVP phê duyệt');
          loadTasks(body);
        } catch (e) { alert('❌ ' + e.message); }
        break;
      case 'download':
        downloadDocFile(btn.dataset.docId);
        break;
      case 'history':
        openHistoryModal(id);
        break;
      case 'delete':
        if (!confirm('Xóa nhiệm vụ này?')) return;
        try {
          await apiDelete(`/api/v1/tasks/${id}`);
          alert('✅ Đã xóa');
          loadTasks(body);
        } catch (e) { alert('❌ ' + e.message); }
        break;
    }
  }

  // ===== CREATE TASK MODAL =====

  function openCreateTaskModal(body) {
    const depts = taskState.departments;
    let deptOptions = depts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

    const overlay = createModalOverlay('Tạo nhiệm vụ mới', `
      <div class="vbdh-form-group">
        <label>Tiêu đề <span class="vbdh-required">*</span></label>
        <input type="text" id="vbdh-ct-title" placeholder="Nhập tiêu đề nhiệm vụ..." class="vbdh-input">
      </div>
      <div class="vbdh-form-group">
        <label>Mô tả</label>
        <textarea id="vbdh-ct-desc" rows="3" placeholder="Mô tả chi tiết..." class="vbdh-input"></textarea>
      </div>
      <div class="vbdh-form-group">
        <label>Số hiệu văn bản giao</label>
        <input type="text" id="vbdh-ct-sohieu" placeholder="VD: 123/UBND-VP" class="vbdh-input">
      </div>
      <div class="vbdh-form-row">
        <div class="vbdh-form-group">
          <label>Ưu tiên</label>
          <select id="vbdh-ct-priority" class="vbdh-input">
            <option value="CAO">🔴 Cao</option>
            <option value="BINH_THUONG" selected>🔵 Bình thường</option>
            <option value="THAP">⚪ Thấp</option>
          </select>
        </div>
        <div class="vbdh-form-group">
          <label>Hạn xử lý</label>
          <input type="date" id="vbdh-ct-deadline" class="vbdh-input">
        </div>
      </div>
      <div class="vbdh-form-group">
        <label>Phòng ban <span class="vbdh-required">*</span></label>
        <select id="vbdh-ct-dept" class="vbdh-input">
          <option value="">-- Chọn phòng ban --</option>
          ${deptOptions}
        </select>
      </div>
      <div class="vbdh-form-actions">
        <button class="vbdh-btn" id="vbdh-ct-cancel">Hủy</button>
        <button class="vbdh-btn vbdh-btn-primary" id="vbdh-ct-submit">Tạo nhiệm vụ</button>
      </div>
    `);

    overlay.querySelector('#vbdh-ct-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#vbdh-ct-submit').onclick = async () => {
      const title = document.getElementById('vbdh-ct-title').value.trim();
      const dept = document.getElementById('vbdh-ct-dept').value;
      if (!title) { alert('Nhập tiêu đề'); return; }
      if (!dept) { alert('Chọn phòng ban'); return; }

      const payload = {
        title,
        description: document.getElementById('vbdh-ct-desc').value.trim(),
        soHieuVanBanGiao: document.getElementById('vbdh-ct-sohieu').value.trim() || null,
        priority: document.getElementById('vbdh-ct-priority').value,
        dueDate: document.getElementById('vbdh-ct-deadline').value || null,
        departmentId: dept,
        sourceType: 'extension',
      };

      try {
        await apiPost('/api/v1/tasks', payload);
        overlay.remove();
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== EDIT TASK MODAL =====

  function openEditModal(taskId) {
    const body = document.getElementById('vbdh-body');
    const task = taskState.tasks.find(t => t.id === taskId);
    if (!task) { alert('Không tìm thấy nhiệm vụ'); return; }

    const depts = taskState.departments;
    const deptOptions = depts.map(d => `<option value="${d.id}" ${task.assignedDepartmentId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
    const deadline = task.deadline ? task.deadline.split('T')[0] : '';

    const overlay = createModalOverlay('Sửa nhiệm vụ: ' + escapeHtml(task.title), `
      <div class="vbdh-form-group">
        <label>Tiêu đề <span class="vbdh-required">*</span></label>
        <input type="text" id="vbdh-et-title" value="${escapeHtml(task.title || '')}" class="vbdh-input">
      </div>
      <div class="vbdh-form-group">
        <label>Mô tả</label>
        <textarea id="vbdh-et-desc" rows="3" class="vbdh-input">${escapeHtml(task.description || '')}</textarea>
      </div>
      <div class="vbdh-form-group">
        <label>Số hiệu văn bản giao</label>
        <input type="text" id="vbdh-et-sohieu" value="${escapeHtml(task.soHieuVanBanGiao || '')}" placeholder="VD: 123/UBND-VP" class="vbdh-input">
      </div>
      <div class="vbdh-form-row">
        <div class="vbdh-form-group">
          <label>Ưu tiên</label>
          <select id="vbdh-et-priority" class="vbdh-input">
            <option value="CAO" ${task.priority === 'CAO' ? 'selected' : ''}>🔴 Cao</option>
            <option value="BINH_THUONG" ${task.priority === 'BINH_THUONG' ? 'selected' : ''}>🔵 Bình thường</option>
            <option value="THAP" ${task.priority === 'THAP' ? 'selected' : ''}>⚪ Thấp</option>
          </select>
        </div>
        <div class="vbdh-form-group">
          <label>Hạn xử lý</label>
          <input type="date" id="vbdh-et-deadline" value="${deadline}" class="vbdh-input">
        </div>
      </div>
      <div class="vbdh-form-group">
        <label>Nguồn giao</label>
        <select id="vbdh-et-source" class="vbdh-input">
          <option value="extension" ${(task.sourceType || 'extension') === 'extension' ? 'selected' : ''}>🌐 Hệ thống VBDH</option>
          <option value="document" ${task.sourceType === 'document' ? 'selected' : ''}>📋 PM giao việc</option>
          <option value="DANG_UY" ${task.sourceType === 'DANG_UY' ? 'selected' : ''}>🔴 Đảng uỷ</option>
        </select>
      </div>
      <div class="vbdh-form-group">
        <label>Phòng ban</label>
        <select id="vbdh-et-dept" class="vbdh-input">
          <option value="">-- Giữ nguyên --</option>
          ${deptOptions}
        </select>
      </div>
      <div class="vbdh-form-actions">
        <button class="vbdh-btn" id="vbdh-et-cancel">Hủy</button>
        <button class="vbdh-btn vbdh-btn-primary" id="vbdh-et-submit">Lưu thay đổi</button>
      </div>
    `);

    overlay.querySelector('#vbdh-et-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#vbdh-et-submit').onclick = async () => {
      const title = document.getElementById('vbdh-et-title').value.trim();
      if (!title) { alert('Nhập tiêu đề'); return; }

      const payload = {
        title,
        description: document.getElementById('vbdh-et-desc').value.trim(),
        soHieuVanBanGiao: document.getElementById('vbdh-et-sohieu').value.trim() || null,
        priority: document.getElementById('vbdh-et-priority').value,
        deadline: document.getElementById('vbdh-et-deadline').value || null,
        sourceType: document.getElementById('vbdh-et-source').value,
      };
      const dept = document.getElementById('vbdh-et-dept').value;
      if (dept) {
        payload.assignedDepartmentId = dept;
      }

      try {
        await apiPut(`/api/v1/tasks/${taskId}`, payload);
        alert('✅ Đã cập nhật nhiệm vụ');
        overlay.remove();
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== ASSIGN TO STAFF MODAL =====

  function openAssignModal(taskId, deptId) {
    const staffInDept = taskState.users.filter(u => {
      const userDeptId = u.department?.id || u.departmentId;
      const userRole = typeof u.role === 'string' ? u.role : (u.role?.name || '');
      return userDeptId === deptId && userRole === 'STAFF' && u.isActive !== false;
    });

    let staffOptions = staffInDept.map(u =>
      `<option value="${u.id}">${escapeHtml(u.fullName || u.username)}</option>`
    ).join('');

    const overlay = createModalOverlay('Phân công nhân viên', `
      <div class="vbdh-form-group">
        <label>Nhân viên <span class="vbdh-required">*</span></label>
        <select id="vbdh-as-staff" class="vbdh-input" multiple size="5">
          ${staffOptions || '<option disabled>Không có nhân viên</option>'}
        </select>
        <small class="vbdh-hint">Giữ Ctrl để chọn nhiều</small>
      </div>
      <div class="vbdh-form-group">
        <label>Hạn hoàn thành</label>
        <input type="date" id="vbdh-as-deadline" class="vbdh-input">
      </div>
      <div class="vbdh-form-actions">
        <button class="vbdh-btn" id="vbdh-as-cancel">Hủy</button>
        <button class="vbdh-btn vbdh-btn-primary" id="vbdh-as-submit">Phân công</button>
      </div>
    `);

    overlay.querySelector('#vbdh-as-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#vbdh-as-submit').onclick = async () => {
      const sel = document.getElementById('vbdh-as-staff');
      const staffIds = Array.from(sel.selectedOptions).map(o => o.value);
      if (staffIds.length === 0) { alert('Chọn nhân viên'); return; }

      try {
        await apiPost(`/api/v1/tasks/${taskId}/assign-dept`, {
          staffIds,
          assignedDeadline: document.getElementById('vbdh-as-deadline').value || null,
        });
        overlay.remove();
        const body = document.getElementById('vbdh-body');
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== REVIEW MODAL (CVP) =====

  function openReviewModal(taskId) {
    const overlay = createModalOverlay('Duyệt nhiệm vụ (CVP)', `
      <div class="vbdh-form-group">
        <label>Hành động</label>
        <select id="vbdh-rv-action" class="vbdh-input">
          <option value="approve">✅ Duyệt — Hoàn thành</option>
          <option value="reject">❌ Từ chối — Trả lại</option>
        </select>
      </div>
      <div class="vbdh-form-group">
        <label>Ghi chú</label>
        <textarea id="vbdh-rv-note" rows="3" class="vbdh-input" placeholder="Nhận xét..."></textarea>
      </div>
      <div class="vbdh-form-actions">
        <button class="vbdh-btn" id="vbdh-rv-cancel">Hủy</button>
        <button class="vbdh-btn vbdh-btn-primary" id="vbdh-rv-submit">Xác nhận</button>
      </div>
    `);

    overlay.querySelector('#vbdh-rv-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#vbdh-rv-submit').onclick = async () => {
      try {
        await apiPost(`/api/v1/tasks/${taskId}/review`, {
          action: document.getElementById('vbdh-rv-action').value,
          note: document.getElementById('vbdh-rv-note').value,
        });
        overlay.remove();
        const body = document.getElementById('vbdh-body');
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== PROGRESS MODAL =====

  function openProgressModal(taskId, currentPct) {
    const overlay = createModalOverlay('Cập nhật tiến độ', `
      <div class="vbdh-progress-info">Tiến độ hiện tại: <b>${currentPct}%</b></div>
      <div class="vbdh-form-group">
        <label>Tiến độ mới: <span id="vbdh-pg-val">${currentPct}%</span></label>
        <input type="range" id="vbdh-pg-slider" min="${currentPct}" max="100" step="10" value="${currentPct}" class="vbdh-slider">
      </div>
      <div class="vbdh-form-group">
        <label>Ghi chú</label>
        <textarea id="vbdh-pg-note" rows="2" class="vbdh-input" placeholder="Mô tả tiến độ..."></textarea>
      </div>
      <div class="vbdh-form-group">
        <label>📁 File minh chứng (tùy chọn)</label>
        <input type="file" id="vbdh-pg-files" multiple accept=".doc,.docx,.pdf,.xls,.xlsx,.ppt,.pptx" class="vbdh-input" style="padding:4px">
      </div>
      <div class="vbdh-form-actions">
        <button class="vbdh-btn" id="vbdh-pg-cancel">Hủy</button>
        <button class="vbdh-btn vbdh-btn-primary" id="vbdh-pg-submit">Cập nhật</button>
      </div>
    `);

    const slider = overlay.querySelector('#vbdh-pg-slider');
    const valSpan = overlay.querySelector('#vbdh-pg-val');
    slider.oninput = () => { valSpan.textContent = slider.value + '%'; };

    overlay.querySelector('#vbdh-pg-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#vbdh-pg-submit').onclick = async () => {
      try {
        const fileInput = document.getElementById('vbdh-pg-files');
        const files = fileInput && fileInput.files && fileInput.files.length > 0 ? Array.from(fileInput.files) : [];
        let filePaths = null;

        // Upload files first if any
        if (files.length > 0) {
          const formData = new FormData();
          for (const f of files) formData.append('files', f);
          const uploadRes = await fetchWithRefresh(`${getApiBase().replace('/api/v1/ext', '/api/v1')}/tasks/${taskId}/progress/files`, {
            method: 'POST',
            body: formData,
            headers: getAuthHeaders(),
          });
          if (!uploadRes.ok) throw new Error('Upload file thất bại');
          const uploadData = await uploadRes.json();
          filePaths = JSON.stringify(uploadData.data || uploadData);
        }

        await apiPost(`/api/v1/tasks/${taskId}/progress`, {
          percent: parseInt(slider.value),
          note: document.getElementById('vbdh-pg-note').value,
          filePaths,
        });
        overlay.remove();
        const body = document.getElementById('vbdh-body');
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== DETAIL MODAL =====

  async function openDetailModal(taskId) {
    const overlay = createModalOverlay('Chi tiết nhiệm vụ', '<div class="vbdh-spinner"></div>', 700);

    try {
      const res = await apiGet(`/api/v1/tasks/${taskId}`);
      const t = res.data?.data || res.data || {};
      const assigneeRes = await apiGet(`/api/v1/tasks/${taskId}/assignments`).catch(() => ({ data: { data: [] } }));
      const assignees = assigneeRes.data?.data || assigneeRes.data || [];

      let html = `
        <div class="vbdh-detail-grid">
          <div class="vbdh-detail-row"><b>Tiêu đề:</b> ${escapeHtml(t.title)}</div>
          <div class="vbdh-detail-row"><b>Mô tả:</b> ${escapeHtml(t.description || '-')}</div>
          <div class="vbdh-detail-row"><b>Số hiệu VB:</b> ${escapeHtml(t.soHieuVanBanGiao || '-')}</div>
          <div class="vbdh-detail-row"><b>Ưu tiên:</b> ${escapeHtml(t.priority || '-')}</div>
          <div class="vbdh-detail-row"><b>Hạn xử lý:</b> ${t.deadline ? formatDateShort(t.deadline) : '-'}</div>
          <div class="vbdh-detail-row"><b>Phòng ban:</b> ${escapeHtml(t.assignedDepartmentName || '-')}</div>
          <div class="vbdh-detail-row"><b>Trạng thái:</b> ${escapeHtml(t.status || '-')}</div>
          <div class="vbdh-detail-row"><b>Tiến độ:</b> ${t.progress || 0}%</div>
        </div>`;

      if (assignees.length > 0) {
        html += '<div class="vbdh-detail-section"><b>Người xử lý:</b></div>';
        html += '<table class="vbdh-table vbdh-detail-table"><thead><tr><th>Tên</th><th>Trạng thái</th><th>Tiến độ</th></tr></thead><tbody>';
        for (const a of assignees) {
          html += `<tr>
            <td>${escapeHtml(a.assigneeName || a.assigneeUsername || 'N/A')}</td>
            <td>${escapeHtml(a.status || '-')}</td>
            <td>${a.progress != null ? a.progress + '%' : '-'}</td>
          </tr>`;
        }
        html += '</tbody></table>';
      }

      if (t.documentId) {
        html += `<div class="vbdh-detail-section"><a href="#" class="vbdh-link" data-dl-doc="${t.documentId}">📎 Tải file gốc</a></div>`;
      }

      // Progress history with files
      try {
        const pgRes = await apiGet(`/api/v1/tasks/${taskId}/progress`);
        const pgHistory = pgRes.data?.data || pgRes.data || [];
        const withFiles = pgHistory.filter(p => p.filePaths);
        if (withFiles.length > 0) {
          html += '<div class="vbdh-detail-section"><b>📁 File minh chứng:</b></div><div class="vbdh-detail-files">';
          for (const p of withFiles) {
            let files = [];
            try { files = typeof p.filePaths === 'string' ? JSON.parse(p.filePaths) : p.filePaths; } catch {}
            if (Array.isArray(files)) {
              for (const fp of files) {
                const fn = fp.split('/').pop().replace(/^[a-f0-9-]+_/, '');
                html += `<div class="vbdh-detail-row"><span>📎 ${escapeHtml(fn)}</span> <span style="color:#999;font-size:12px">— ${p.userFullName || p.userName || ''} (${p.progress}%)</span></div>`;
              }
            }
          }
          html += '</div>';
        }
      } catch {}

      overlay.querySelector('.vbdh-modal-body').innerHTML = html;
    } catch (e) {
      overlay.querySelector('.vbdh-modal-body').innerHTML = `<div class="vbdh-error">❌ ${escapeHtml(e.message)}</div>`;
    }
  }

  // ===== HISTORY MODAL =====

  async function openHistoryModal(taskId) {
    const overlay = createModalOverlay('Lịch sử', '<div class="vbdh-spinner"></div>', 700);

    try {
      const [progRes, revRes] = await Promise.all([
        apiGet(`/api/v1/tasks/${taskId}/progress`).catch(() => ({ data: { data: [] } })),
        apiGet(`/api/v1/tasks/${taskId}/reviews`).catch(() => ({ data: { data: [] } })),
      ]);

      const progress = progRes.data?.data || progRes.data || [];
      const reviews = revRes.data?.data || revRes.data || [];

      // Merge & sort by time desc
      const events = [
        ...reviews.map(r => ({ type: 'review', time: r.createdAt, ...r })),
        ...progress.map(p => ({ type: 'progress', time: p.createdAt, ...p })),
      ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

      if (events.length === 0) {
        overlay.querySelector('.vbdh-modal-body').innerHTML = '<div class="vbdh-empty">Chưa có lịch sử</div>';
        return;
      }

      let html = '<div class="vbdh-timeline">';
      for (const e of events) {
        if (e.type === 'review') {
          const isApprove = e.action === 'approve';
          html += `<div class="vbdh-timeline-item ${isApprove ? 'vbdh-tl-green' : 'vbdh-tl-red'}">`;
          html += `<b>${isApprove ? '✅' : '❌'} ${isApprove ? 'Phê duyệt' : 'Từ chối'}</b> — ${escapeHtml(e.reviewerName || 'N/A')}`;
          html += `<div class="vbdh-tl-time">${formatDate(e.time)}</div>`;
          if (e.note) html += `<div class="vbdh-tl-note">💬 ${escapeHtml(e.note)}</div>`;
          html += '</div>';
        } else {
          html += `<div class="vbdh-timeline-item vbdh-tl-blue">`;
          html += `<b>📊 Tiến độ: ${e.progress ?? e.percent ?? 0}%</b> — ${escapeHtml(e.userFullName || e.userName || 'N/A')}`;
          html += `<div class="vbdh-tl-time">${formatDate(e.time)}</div>`;
          if (e.note) html += `<div class="vbdh-tl-note">💬 ${escapeHtml(e.note)}</div>`;
          html += '</div>';
        }
      }
      html += '</div>';

      overlay.querySelector('.vbdh-modal-body').innerHTML = html;
    } catch (e) {
      overlay.querySelector('.vbdh-modal-body').innerHTML = `<div class="vbdh-error">❌ ${escapeHtml(e.message)}</div>`;
    }
  }

  // ===== MODAL HELPER =====

  function createModalOverlay(title, content, width = 550) {
    const overlay = document.createElement('div');
    overlay.className = 'vbdh-sub-modal';
    overlay.innerHTML = `
      <div class="vbdh-sub-overlay"></div>
      <div class="vbdh-sub-container" style="max-width:${width}px">
        <div class="vbdh-sub-header">
          <h3>${title}</h3>
          <button class="vbdh-close" title="Đóng">&times;</button>
        </div>
        <div class="vbdh-modal-body">${content}</div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.vbdh-close').onclick = () => overlay.remove();
    overlay.querySelector('.vbdh-sub-overlay').onclick = () => overlay.remove();

    return overlay;
  }

  // ===== GLOBAL FUNCTIONS FOR PAGINATION =====
  window.__vbdhTaskPage = (page) => {
    taskState.page = page;
    const body = document.getElementById('vbdh-body');
    loadTasks(body);
  };

  // ===================================================================
  // EXTRACT DOCUMENTS (kept from original inject.js)
  // ===================================================================

  // Phân loại theo Sổ văn bản:
  // - 'công văn đến' (vd: 'Sổ Công văn đến UBND xã Hòa Tiến 2026') → Non-Thông báo: 1 nhiệm vụ (AI tóm tắt)
  // - 'công văn' nhưng KHÔNG chứa 'công văn đến' (vd: 'Sổ Công văn UBND xã Hòa Tiến 2026') → Thông báo: nhiều nhiệm vụ (AI trích xuất)
  // - Trường hợp khác → mặc định Non-Thông báo
  function isExtractableDoc(doc) {
    const soVanBan = (doc && doc.soVanBan || '').toLowerCase();
    if (!soVanBan) return false; // không có sổ văn bản → mặc định non-thông báo
    if (soVanBan.includes('công văn đến')) return false; // công văn đến → non-thông báo
    if (soVanBan.includes('công văn')) return true; // công văn (đi) → thông báo
    return false; // mặc định non-thông báo
  }

  // Load departments for extraction form (if not already loaded)
  async function ensureDepartmentsLoaded() {
    if (extractState.departments.length > 0) return;
    try {
      const res = await apiGet('/api/v1/admin/departments');
      extractState.departments = res.data?.data || res.data || [];
    } catch (e) { console.warn('[VBDH] Failed to load departments:', e); }
  }

  // Resolve department name via backend (single source of truth)
  // Now calls POST /api/v1/departments/resolve on tbkl backend
  async function resolveDeptNameToId(name, apiUrl) {
    // Allow empty string — backend will fallback to VPHDND
    const trimmedName = (name || '').trim();
    const baseUrl = apiUrl.replace('/api/v1/ext', '/api/v1');
    try {
      const res = await fetchWithRefresh(`${baseUrl}/departments/resolve`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName })
      });
      if (!res.ok) return '';
      const json = await res.json();
      const data = json.data || json;
      return data.departmentId || '';
    } catch (e) {
      console.warn('[VBDH] resolveDeptNameToId failed:', e.message);
      return '';
    }
  }

  // Batch resolve multiple department names via backend
  async function resolveDeptNamesToIds(names, apiUrl) {
    if (!names || names.length === 0) return [];
    const baseUrl = apiUrl.replace('/api/v1/ext', '/api/v1');
    try {
      const res = await fetchWithRefresh(`${baseUrl}/departments/resolve-batch`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ names })
      });
      if (!res.ok) return names.map(() => '');
      const json = await res.json();
      const list = json.data || json;
      if (Array.isArray(list)) {
        return list.map(item => item.departmentId || '');
      }
      return names.map(() => '');
    } catch (e) {
      console.warn('[VBDH] resolveDeptNamesToIds failed:', e.message);
      return names.map(() => '');
    }
  }

  async function processAllDocuments(modal) {
    const body = modal.querySelector('#vbdh-body');
    body.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang phân tích văn bản...</p></div>';

    // Load departments for extraction form
    await ensureDepartmentsLoaded();

    const docs = await extractAllDocuments();
    console.log('[VBDH] Found', docs.length, 'open documents');

    if (docs.length === 0) {
      body.innerHTML = '<div class="vbdh-empty">📭 Không tìm thấy văn bản nào đang mở chi tiết.</div>';
      return;
    }

    let html = '';
    extractState.docs = docs; // store for later access (soHieuVanBanGiao)
    for (let i = 0; i < docs.length; i++) {
      html += buildDocAccordion(docs[i], i);
    }
    body.innerHTML = html;

    updateDocFileCounts(docs);

    body.querySelectorAll('.vbdh-doc-header').forEach(header => {
      header.onclick = () => {
        const content = header.nextElementSibling;
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        header.querySelector('.vbdh-arrow').textContent = isOpen ? '▶' : '▼';
      };
    });

    body.querySelectorAll('.vbdh-file-header').forEach(header => {
      header.onclick = () => {
        const content = header.nextElementSibling;
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        header.querySelector('.vbdh-arrow').textContent = isOpen ? '▶' : '▼';
      };
    });

    for (let i = 0; i < docs.length; i++) {
      const isThongBao = isExtractableDoc(docs[i]);
      if (isThongBao) {
        // Flow: download files → upload → AI → tasks
        for (let j = 0; j < docs[i].files.length; j++) {
          await processSingleFile(docs[i], docs[i].files[j], i, j);
        }
      } else {
        // Non-ThongBao: download file → AI summarize → create 1 task with summary as description
        await processNonThongBaoDoc(docs[i], i);
      }
      updateDocTaskBadge(docs, i);
    }
  }

  async function extractAllDocuments() {
    const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
    console.log('[VBDH-DEBUG] extractAllDocuments — found', wrappers.length, 'MuiCollapse-wrapperInner elements');
    const docs = [];
    for (let wIdx = 0; wIdx < wrappers.length; wIdx++) {
      const w = wrappers[wIdx];
      const hasFile = !!w.querySelector('.file');
      const hasBold = !!w.querySelector('td.bold');
      const hasFileName = !!w.querySelector('.file__name');
      const isVisible = w.offsetHeight > 0;
      console.log(`[VBDH-DEBUG] wrapper[${wIdx}]: visible=${isVisible}, .file=${hasFile}, td.bold=${hasBold}, .file__name=${hasFileName}, offsetHeight=${w.offsetHeight}`);

      if (isVisible && hasBold && (hasFile && hasFileName)) {
        // === VB ĐẾN flow ===
        const info = {};
        w.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          cells.forEach((cell, idx) => {
            if (cell.classList.contains('bold') && idx + 1 < cells.length) {
              info[cell.textContent.trim()] = cells[idx + 1].textContent.trim();
            }
          });
        });
        console.log(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đến) info keys:`, Object.keys(info));
        const files = extractFilesFromWrapper(w, wIdx);
        console.log(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đến) extracted ${files.length} files`);
        if (files.length > 0) {
          docs.push({
            soKyHieu: info['Số, ký hiệu VB'] || '',
            trichYeu: info['Trích yếu'] || '',
            coQuanBanHanh: info['Cơ quan ban hành'] || '',
            ngayBanHanh: info['Ngày ban hành'] || '',
            loaiVanBan: info['Loại văn bản'] || '',
            nguoiKy: info['Người ký'] || '',
            soVanBan: info['Sổ văn bản'] || '',
            maDinhDanh: info['Mã định danh'] || '',
            files: files,
          });
        } else {
          console.warn(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đến) has selectors but 0 files from React Fiber — info:`, info);
        }
      } else if (isVisible && hasBold) {
        // === VB ĐI flow: td.bold + span.link ===
        const info = {};
        w.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          cells.forEach((cell, idx) => {
            if (cell.classList.contains('bold') && idx + 1 < cells.length) {
              info[cell.textContent.trim()] = cells[idx + 1].textContent.trim();
            }
          });
        });
        console.log(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đi) info keys:`, Object.keys(info));
        const files = await extractFilesFromWrapperVBDi(w, wIdx);
        console.log(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đi) extracted ${files.length} files`);
        if (files.length > 0) {
          // VB đi labels: Sổ văn bản, Người trình, Loại văn bản, Người ký,
          // Số ký hiệu, Người soạn, Ngày ban hành, Số bản, Cơ quan ban hành,
          // Số tờ, Số đi, Độ khẩn, Lĩnh vực văn bản, Nơi nhận, Chữ ký số,
          // Hồ sơ công việc, Phòng soạn, Tệp đính kèm
          docs.push({
            soKyHieu: info['Số ký hiệu'] || info['Số, ký hiệu VB'] || '',
            trichYeu: info['Trích yếu'] || info['Nội dung'] || '',
            coQuanBanHanh: info['Cơ quan ban hành'] || '',
            ngayBanHanh: info['Ngày ban hành'] || '',
            loaiVanBan: info['Loại văn bản'] || '',
            linhVucVanBan: info['Lĩnh vực văn bản'] || '',
            nguoiKy: info['Người ký'] || '',
            nguoiTrinh: info['Người trình'] || '',
            nguoiSoan: info['Người soạn'] || '',
            soVanBan: info['Sổ văn bản'] || '',
            soDi: info['Số đi'] || '',
            doKhan: info['Độ khẩn'] || '',
            noiNhan: info['Nơi nhận'] || '',
            phongSoan: info['Phòng soạn'] || '',
            soBan: info['Số bản'] || '',
            soTo: info['Số tờ'] || '',
            maDinhDanh: info['Mã định danh'] || '',
            files: files,
          });
        } else {
          console.warn(`[VBDH-DEBUG] wrapper[${wIdx}] (VB đi) 0 files extracted — info:`, info);
        }
      } else {
        if (w.offsetHeight > 0) {
          console.log(`[VBDH-DEBUG] wrapper[${wIdx}] VISIBLE but missing selectors — .file=${hasFile}, td.bold=${hasBold}, .file__name=${hasFileName}`);
          const childClasses = [];
          w.querySelectorAll('[class]').forEach(el => {
            el.classList.forEach(c => { if (!childClasses.includes(c)) childClasses.push(c); });
          });
          console.log(`[VBDH-DEBUG] wrapper[${wIdx}] all CSS classes found:`, childClasses.slice(0, 30));
        }
      }
    }
    console.log('[VBDH-DEBUG] extractAllDocuments total docs:', docs.length);
    return docs;
  }

  function extractFilesFromWrapper(wrapper, wIdx) {
    let filesData = [];
    const rk = Object.keys(wrapper).find(k => k.startsWith('__reactFiber$'));
    if (!rk) {
      console.warn(`[VBDH-DEBUG] wrapper[${wIdx}] NO __reactFiber$ key found. Internal keys:`, Object.keys(wrapper).filter(k => k.startsWith('__')).slice(0, 10));
      return [];
    }

    // === BFS traverse to find files prop ===
    let fiber = wrapper[rk];
    let queue = [fiber];
    let visited = 0;
    const maxNodes = 300;

    while (queue.length > 0 && visited < maxNodes) {
      let node = queue.shift();
      visited++;
      const p = node.memoizedProps;
      if (p && Array.isArray(p.files) && p.files.length > 0 && p.files[0].tenTep) {
        filesData = p.files.map(function(f) { return { name: f.tenTep, url: f.url, mimeType: f.kieuTep || 'application/pdf' }; });
        console.log('[VBDH-DEBUG] wrapper[' + wIdx + '] FOUND ' + filesData.length + ' files at BFS node #' + visited + ':', filesData.map(function(f) { return f.name; }));
        break;
      }
      // Add children to BFS queue
      let child = node.child;
      while (child) {
        queue.push(child);
        child = child.sibling;
      }
    }

    if (filesData.length === 0) {
      console.warn('[VBDH-DEBUG] wrapper[' + wIdx + '] BFS visited ' + visited + ' nodes, no files with tenTep found');
    }

    return filesData;
  }

  // === VB ĐI: extract files from span.link via click interception ===
  // Strategy: Override window.open temporarily, click each span.link, capture URL
  function extractFilesFromWrapperVBDi(wrapper, wIdx) {
    const links = wrapper.querySelectorAll('span.link');
    console.log('[VBDH-DEBUG] wrapper[' + wIdx + '] (VB đi) found ' + links.length + ' span.link elements');
    if (links.length === 0) return [];

    // Get file names from span.link textContent
    const fileNames = [];
    links.forEach((link, idx) => {
      const name = (link.textContent || '').trim();
      if (name && name.length > 2) fileNames.push({ name: name, linkEl: link, idx: idx });
    });
    console.log('[VBDH-DEBUG] wrapper[' + wIdx + '] (VB đi) file names:', fileNames.map(f => f.name));

    // Intercept window.open to capture download URLs
    const capturedUrls = [];
    const origWindowOpen = window.open;
    window.open = function(url) {
      if (url && url.includes('filemanagement')) {
        console.log('[VBDH-DEBUG] (VB đi) captured download URL:', url);
        capturedUrls.push(url);
      }
      return null; // block actual navigation
    };

    // Click each link sequentially with small delay
    fileNames.forEach((f, i) => {
      setTimeout(() => {
        try {
          f.linkEl.click();
        } catch (e) {
          console.warn('[VBDH-DEBUG] click error on link[' + i + ']:', e);
        }
      }, i * 300);
    });

    // Wait for all clicks, then build result
    const totalWait = fileNames.length * 300 + 1000;
    // Return placeholder — actual URLs will be resolved asynchronously
    // For now, return with empty URLs and fill in later via callback
    return new Promise((resolve) => {
      setTimeout(() => {
        window.open = origWindowOpen; // restore
        console.log('[VBDH-DEBUG] wrapper[' + wIdx + '] (VB đi) captured ' + capturedUrls.length + ' URLs:', capturedUrls);

        const filesData = fileNames.map((f, i) => ({
          name: f.name,
          url: capturedUrls[i] || '',
          mimeType: 'application/pdf'
        }));

        // Filter out files without URL
        const validFiles = filesData.filter(f => f.url);
        console.log('[VBDH-DEBUG] wrapper[' + wIdx + '] (VB đi) valid files: ' + validFiles.length + '/' + filesData.length);
        resolve(validFiles);
      }, totalWait);
    });
  }

  function buildDocAccordion(doc, docIndex) {
    const title = doc.trichYeu || doc.soKyHieu || 'Văn bản ' + (docIndex + 1);
    const shortTitle = title.length > 80 ? title.substring(0, 80) + '...' : title;
    const isThongBao = isExtractableDoc(doc);
    let filesHtml = '';
    if (isThongBao) {
      for (let j = 0; j < doc.files.length; j++) {
        const f = doc.files[j];
        const shortName = f.name.length > 50 ? f.name.substring(0, 50) + '...' : f.name;
        filesHtml += `
          <div class="vbdh-file-item">
            <div class="vbdh-file-header">
              <span class="vbdh-arrow">▶</span>
              <span class="vbdh-file-icon">📄</span>
              <span class="vbdh-file-name">${shortName}</span>
              <span class="vbdh-status vbdh-status-pending" id="vbdh-status-${docIndex}-${j}">⏳ Chờ xử lý</span>
            </div>
            <div class="vbdh-file-content" style="display:none" id="vbdh-content-${docIndex}-${j}">
              <div id="vbdh-result-${docIndex}-${j}" class="vbdh-result-loading">
                <div class="vbdh-spinner"></div><p>Đang xử lý...</p>
              </div>
            </div>
          </div>`;
      }
    } else {
      // Non-ThongBao: download file → AI summarize → create task
      const firstFile = doc.files.length > 0 ? doc.files[0].name : '';
      filesHtml = `
        <div class="vbdh-file-item">
          <div class="vbdh-file-header">
            <span class="vbdh-arrow">▶</span>
            <span class="vbdh-file-icon">📝</span>
            <span class="vbdh-file-name">${firstFile ? 'Tóm tắt: ' + escapeHtml(firstFile.length > 50 ? firstFile.substring(0,50) + '...' : firstFile) : 'Tóm tắt AI'}</span>
            <span class="vbdh-status vbdh-status-pending" id="vbdh-status-${docIndex}-0">⏳ Chờ xử lý</span>
          </div>
          <div class="vbdh-file-content" style="display:none" id="vbdh-content-${docIndex}-0">
            <div id="vbdh-result-${docIndex}-0" class="vbdh-result-loading">
              <div class="vbdh-spinner"></div><p>Đang xử lý...</p>
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="vbdh-doc-accordion" data-doc="${docIndex}">
        <div class="vbdh-doc-header">
          <span class="vbdh-arrow">▶</span>
          <div class="vbdh-doc-title">
            <strong>${doc.soKyHieu}</strong> — ${shortTitle}
            <span class="vbdh-file-count" id="vbdh-file-count-${docIndex}">${isThongBao ? doc.files.length + ' file(s)' : 'Không có file'}</span>
          </div>
        </div>
        <div class="vbdh-doc-content" style="display:none" id="vbdh-doc-content-${docIndex}">
          <div class="vbdh-doc-info">
            <div><b>Cơ quan:</b> ${doc.coQuanBanHanh}</div>
            <div><b>Ngày:</b> ${doc.ngayBanHanh}</div>
            <div><b>Loại:</b> ${doc.loaiVanBan}</div>
          </div>
          ${filesHtml}
        </div>
      </div>`;
  }

  async function processSingleFile(doc, file, docIndex, fileIndex) {
    const statusEl = document.getElementById(`vbdh-status-${docIndex}-${fileIndex}`);
    const resultEl = document.getElementById(`vbdh-result-${docIndex}-${fileIndex}`);
    if (!statusEl || !resultEl) return; // DOM not ready
    const a = window.__vbdhAuth;
    const apiUrl = getApiUrl();

    if (!a || !a.token) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Chưa đăng nhập';
      resultEl.innerHTML = '<div class="vbdh-error">Vui lòng đăng nhập.</div>';
      return;
    }

    try {
      const cacheKey = generateCacheKey(doc, file);
      statusEl.textContent = '⏳ Kiểm tra cache...';
      const cacheResult = await checkCache(apiUrl, cacheKey);

      if (cacheResult.found && cacheResult.documentId) {
        // Check if document already has tasks
        const hasTasks = await checkDocHasTasks(apiUrl, cacheResult.documentId);
        if (hasTasks) {
          statusEl.className = 'vbdh-status vbdh-status-done';
          statusEl.textContent = '✅ Đã có NV';
          resultEl.innerHTML = '<div class="vbdh-info" style="padding:12px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:4px;color:#003a8c;">📋 Văn bản này đã được tạo nhiệm vụ. Để tạo lại, vui lòng xóa các nhiệm vụ cũ trong hệ thống.</div>';
          return;
        }
        if ((cacheResult.status === 'completed' || cacheResult.status === 'extracted') && cacheResult.extractionResult) {
          statusEl.className = 'vbdh-status vbdh-status-done';
          statusEl.textContent = '⚡ Cache';
          await displayResult({ extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true }, statusEl, resultEl, cacheResult.documentId, apiUrl);
          return;
        }
        if (cacheResult.status === 'processing' || cacheResult.status === 'extracting') {
          statusEl.className = 'vbdh-status vbdh-status-pending';
          statusEl.textContent = '⏳ AI đang xử lý...';
          const extractData = await pollUntilDone(apiUrl, cacheResult.documentId, statusEl);
          await displayResult(extractData, statusEl, resultEl, cacheResult.documentId, apiUrl);
          return;
        }
        if (cacheResult.extractionResult) {
          statusEl.className = 'vbdh-status vbdh-status-done';
          statusEl.textContent = '⚡ Cache';
          await displayResult({ extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true }, statusEl, resultEl, cacheResult.documentId, apiUrl);
          return;
        }
      }

      statusEl.textContent = '⏳ Đang tải file...';
      const blob = await fetchFile(file.url);
      if (!blob) {
        statusEl.className = 'vbdh-status vbdh-status-error';
        statusEl.textContent = '❌ Lỗi tải file';
        resultEl.innerHTML = '<div class="vbdh-error">Không tải được file.</div>';
        return;
      }

      statusEl.textContent = '⏳ Đang upload...';
      const singleDoc = { ...doc, files: [{ name: file.name }] };
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ ...singleDoc, cacheKey }));
      formData.append('cacheKey', cacheKey);
      formData.append('files', blob, file.name);

      const uploadRes = await fetchWithRefresh(`${apiUrl}/documents/upload`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);
      const uploadJson = await uploadRes.json();
      const results = uploadJson.data?.results || [];
      const docResult = results[0];
      if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

      const documentId = docResult.documentId;
      statusEl.className = 'vbdh-status vbdh-status-pending';
      statusEl.textContent = '⏳ AI đang xử lý...';
      const extractData = await pollUntilDone(apiUrl, documentId, statusEl);
      await displayResult(extractData, statusEl, resultEl, documentId, apiUrl);
    } catch (error) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Lỗi';
      resultEl.innerHTML = `<div class="vbdh-error">${error.message}</div>`;
    }
  }

  async function checkCache(apiUrl, cacheKey) {
    try {
      const res = await fetchWithRefresh(`${apiUrl}/documents/check-cache`, {
        method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ cacheKey }),
      });
      if (!res.ok) return { found: false };
      const json = await res.json();
      const data = json.data;
      if (data && data.exists) return { found: true, documentId: data.documentId, status: data.status, extractionResult: data.extractionResult || null };
    } catch (e) { console.warn('[VBDH] Cache check error:', e); }
    return { found: false };
  }

  // Check if document already has tasks created
  async function checkDocHasTasks(apiUrl, documentId) {
    try {
      const res = await fetchWithRefresh(`${apiUrl.replace('/api/v1/ext', '/api/v1')}/documents/task-counts`, { headers: getAuthHeaders() });
      if (!res.ok) return false;
      const json = await res.json();
      const counts = json.data || {};
      return (counts[documentId] || 0) > 0;
    } catch (e) { return false; }
  }

  async function pollUntilDone(apiUrl, documentId, statusEl) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(3000);
      if (statusEl) statusEl.textContent = `⏳ AI xử lý (${attempt + 1}/60)...`;
      try {
        const res = await fetchWithRefresh(`${apiUrl}/documents/${documentId}/result`, { headers: getAuthHeaders() });
        if (!res.ok) continue;
        const json = await res.json();
        const data = json.data;
        if ((data.status === 'completed' || data.status === 'extracted') && data.extractionResult) return data;
        if (data.status === 'error') throw new Error('AI xử lý thất bại');
        if (data.extractionResult && typeof data.extractionResult === 'object' && Object.keys(data.extractionResult).length > 0) return data;
      } catch (e) { if (e.message === 'AI xử lý thất bại') throw e; }
    }
    throw new Error('Quá thời gian chờ AI xử lý');
  }

  async function displayResult(data, statusEl, resultEl, documentId, apiUrl) {
    const extraction = data.extractionResult || {};
    const isCached = data._cached === true;
    statusEl.className = 'vbdh-status vbdh-status-done';
    statusEl.textContent = isCached ? '⚡ Cache' : '✅ Xong';

    const summary = extraction.summary || extraction.raw || '';
    const rawTasks = extraction.tasks || [];

    // Collect department names to resolve in batch
    const deptNames = rawTasks.map(t => {
      const name = (typeof t === 'object' && t.department) ? t.department : '';
      return name || '';
    });

    // Resolve all department names via backend (Layer 1)
    const deptIds = await resolveDeptNamesToIds(deptNames, apiUrl);

    // Layer 2: AI suggest cho task chưa match department
    const deptIdSet = new Set(extractState.departments.map(d => d.id));
    const needAiSuggest = [];
    for (let i = 0; i < rawTasks.length; i++) {
      if (!deptIds[i] || !deptIdSet.has(deptIds[i])) {
        needAiSuggest.push(i);
      }
    }
    if (needAiSuggest.length > 0) {
      const deptNameList = extractState.departments.map(d => d.name);
      for (const i of needAiSuggest) {
        const taskTitle = typeof rawTasks[i] === 'string' ? rawTasks[i] : (rawTasks[i].title || '');
        if (!taskTitle || taskTitle.trim().length < 5) continue;
        try {
          const baseUrl = apiUrl.replace('/api/v1/ext', '/api/v1');
          const aiRes = await fetchWithRefresh(`${baseUrl}/ai/suggest-department`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: taskTitle, departments: deptNameList })
          });
          if (aiRes.ok) {
            const aiJson = await aiRes.json();
            const suggested = aiJson.data || aiJson;
            if (suggested?.department) {
              // Resolve tên AI suggest → UUID
              const resolved = await resolveDeptNameToId(suggested.department, apiUrl);
              if (resolved) {
                deptIds[i] = resolved;
                // Cập nhật departmentName nếu AI trả tên khác
                if (typeof rawTasks[i] === 'object') {
                  rawTasks[i].department = suggested.department;
                }
              }
            }
          }
        } catch (e) {
          console.warn('[VBDH] AI suggest department failed for task', i, e.message);
        }
      }
    }

    // Parse tasks into editable format (need for-loop for async fallback)
    const newTasks = [];
    // Pre-resolve fallback VPHDND once for all unmatched tasks
    let fallbackDeptId = '';
    const hasUnmatched = deptIds.some(id => !id);
    if (hasUnmatched) {
      fallbackDeptId = await resolveDeptNameToId('', apiUrl);
    }
    for (let idx = 0; idx < rawTasks.length; idx++) {
      const t = rawTasks[idx];
      const taskTitle = typeof t === 'string' ? t : (t.title || '');
      const taskDesc = (typeof t === 'object' && t.description) ? t.description : '';
      const deptName = (typeof t === 'object' && t.department) ? t.department : '';
      const deadline = (typeof t === 'object' && (t.deadline || t.dueDate)) ? (t.deadline || t.dueDate) : '';
      const priority = (typeof t === 'object' && t.priority === 'urgent') ? 'CAO' : 'BINH_THUONG';
      let deptId = deptIds[idx] || fallbackDeptId || '';
      const deptNameDisplay = deptName || 'Văn phòng HĐND-UBND';
      newTasks.push({ idx: extractState.tasks.length + idx, title: taskTitle, description: taskDesc, departmentName: deptNameDisplay, department: deptId, priority, deadline, selected: true, _documentId: documentId });
    }
    // Remove existing tasks for this document to prevent duplicates
    extractState.tasks = extractState.tasks.filter(t => t && t._documentId !== documentId);
    extractState.tasks.push(...newTasks);

    let html = '';
    html += '<div class="vbdh-summary-line">📝 <b>Tóm tắt:</b> ' + (summary || 'Không có tóm tắt') + '</div>';
    html += '<div class="vbdh-section-header"><span class="vbdh-section-title">📋 Nhiệm vụ trích xuất</span>';
    html += `<button class="vbdh-btn-reprocess" title="Xử lý lại" id="vbdh-reprocess-${documentId}">🔄</button></div>`;

    if (newTasks.length > 0) {
      html += '<div class="vbdh-extract-info">Chọn nhiệm vụ, điền thông tin, rồi bấm <b>"Tạo nhiệm vụ"</b></div>';
      html += '<table class="vbdh-table vbdh-extract-table"><thead><tr>';
      html += '<th style="width:36px">✅</th>';
      html += '<th>Nhiệm vụ</th>';
      html += '<th style="width:90px">Ưu tiên</th>';
      html += '<th style="width:130px">Hạn xử lý</th>';
      html += '<th style="width:140px">Phòng ban</th>';
      html += '<th style="width:32px"></th>';
      html += '</tr></thead><tbody>';
      for (let i = 0; i < newTasks.length; i++) {
        const t = newTasks[i];
        const gIdx = t.idx; // global index in extractState.tasks
        html += `<tr data-task-idx="${gIdx}">`;
        html += `<td><input type="checkbox" class="vbdh-extract-check" data-idx="${gIdx}" ${t.selected ? 'checked' : ''}></td>`;
        html += `<td style="text-align:left"><b class="vbdh-task-title">${escapeHtml(t.title)}</b>`;
        if (t.description && t.description !== t.title) html += `<div class="vbdh-task-desc">${escapeHtml(t.description)}</div>`;
        html += '</td>';
        // Priority select
        html += `<td><select class="vbdh-extract-priority" data-idx="${gIdx}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;">`;
        html += '<option value="CAO"' + (t.priority === 'CAO' ? ' selected' : '') + '>Cao</option>';
        html += '<option value="BINH_THUONG"' + (t.priority === 'BINH_THUONG' ? ' selected' : '') + '>Bình thường</option>';
        html += '<option value="THAP"' + (t.priority === 'THAP' ? ' selected' : '') + '>Thấp</option>';
        html += '</select></td>';
        // Deadline input
        html += `<td><input type="date" class="vbdh-extract-deadline" data-idx="${gIdx}" value="${t.deadline || ''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;"></td>`;
        // Department select
        html += `<td><select class="vbdh-extract-dept" data-idx="${gIdx}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;"><option value="">-- Phòng ban --</option>`;
        for (const dept of extractState.departments) {
          html += `<option value="${dept.id}"${t.department === dept.id ? ' selected' : ''}>${escapeHtml(dept.name)}</option>`;
        }
        html += '</select></td>';
        // Delete button
        html += `<td><button class="vbdh-extract-del" data-idx="${gIdx}" title="Xóa" style="background:none;border:none;color:#ff4d4f;cursor:pointer;font-size:16px;">✕</button></td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      // Create tasks button
      html += '<div class="vbdh-extract-actions">';
      html += `<button class="vbdh-btn vbdh-btn-primary" id="vbdh-btn-create-tasks-${documentId}">✅ Tạo nhiệm vụ (${extractState.tasks.filter(t => t && t.selected && t._documentId === documentId).length})</button>`;
      html += '</div>';
    } else {
      html += '<div class="vbdh-no-data">Không có nhiệm vụ</div>';
    }

    resultEl.innerHTML = html;

    // Bind events
    bindExtractTableEvents(resultEl, documentId, apiUrl, statusEl);

    const reprocessBtn = document.getElementById(`vbdh-reprocess-${documentId}`);
    if (reprocessBtn) {
      reprocessBtn.onclick = async () => {
        if (!confirm('Xử lý lại file này?')) return;
        reprocessBtn.disabled = true;
        statusEl.className = 'vbdh-status vbdh-status-pending';
        statusEl.textContent = '⏳ Xử lý lại';
        resultEl.innerHTML = '<div class="vbdh-spinner"></div><p>Đang xử lý lại...</p>';
        try {
          await fetchWithRefresh(`${apiUrl}/documents/${documentId}/re-extract`, { method: 'POST', headers: getAuthHeaders() });
          const d = await pollUntilDone(apiUrl, documentId, statusEl);
          await displayResult(d, statusEl, resultEl, documentId, apiUrl);
        } catch (e) {
          statusEl.className = 'vbdh-status vbdh-status-error';
          statusEl.textContent = '❌ Lỗi';
          resultEl.innerHTML = `<div class="vbdh-error">${e.message}</div>`;
        }
      };
    }
  }

  function bindExtractTableEvents(resultEl, documentId, apiUrl, statusEl) {
    // Checkbox toggle
    resultEl.querySelectorAll('.vbdh-extract-check').forEach(cb => {
      cb.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (extractState.tasks[idx]) extractState.tasks[idx].selected = e.target.checked;
        updateCreateButton(documentId);
      });
    });
    // Priority change
    resultEl.querySelectorAll('.vbdh-extract-priority').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (extractState.tasks[idx]) extractState.tasks[idx].priority = e.target.value;
      });
    });
    // Deadline change
    resultEl.querySelectorAll('.vbdh-extract-deadline').forEach(inp => {
      inp.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (extractState.tasks[idx]) extractState.tasks[idx].deadline = e.target.value;
      });
    });
    // Department change
    resultEl.querySelectorAll('.vbdh-extract-dept').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        if (extractState.tasks[idx]) extractState.tasks[idx].department = e.target.value;
      });
    });
    // Delete row
    resultEl.querySelectorAll('.vbdh-extract-del').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.idx);
        extractState.tasks[idx] = null; // soft delete
        const row = e.target.closest('tr');
        if (row) row.remove();
        updateCreateButton(documentId);
      });
    });
    // Create tasks button
    const createBtn = document.getElementById(`vbdh-btn-create-tasks-${documentId}`);
    if (createBtn) {
      createBtn.addEventListener('click', () => handleCreateExtractTasks(documentId, apiUrl, statusEl, resultEl));
    }
  }

  function updateCreateButton(documentId) {
    const btn = document.getElementById(`vbdh-btn-create-tasks-${documentId}`);
    if (!btn) return;
    // Count from DOM checkboxes within the same result container
    const container = btn.closest('[id^="vbdh-result-"]');
    let count = 0;
    if (container) {
      count = Array.from(container.querySelectorAll('.vbdh-extract-check')).filter(cb => cb.checked).length;
    }
    btn.textContent = `✅ Tạo nhiệm vụ (${count})`;
    btn.disabled = count === 0;
  }

  async function handleCreateExtractTasks(documentId, apiUrl, statusEl, resultEl, docIndex) {
    // Read task data directly from DOM table rows — more reliable than extractState array
    // (avoids index drift from delete/re-process race conditions)
    const tbody = resultEl.querySelector('.vbdh-extract-table tbody');
    if (!tbody) { alert('Không tìm thấy danh sách nhiệm vụ'); return; }

    // Get soKyHieu from doc data for soHieuVanBanGiao field
    const docData = (docIndex !== undefined && extractState.docs[docIndex]) ? extractState.docs[docIndex] : null;
    const soHieuVanBanGiao = docData ? (docData.soKyHieu || null) : null;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const tasksFromDom = [];
    for (const row of rows) {
      const checkEl = row.querySelector('.vbdh-extract-check');
      if (!checkEl || !checkEl.checked) continue; // only checked tasks

      const titleEl = row.querySelector('.vbdh-task-title');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (!title) continue;

      const descEl = row.querySelector('.vbdh-task-desc');
      const priorityEl = row.querySelector('.vbdh-extract-priority');
      const deadlineEl = row.querySelector('.vbdh-extract-deadline');
      const deptEl = row.querySelector('.vbdh-extract-dept');

      const deadlineValue = deadlineEl ? (deadlineEl.value || null) : null;
      tasksFromDom.push({
        title: title,
        description: descEl ? descEl.textContent.trim() : title,
        priority: priorityEl ? priorityEl.value : 'BINH_THUONG',
        dueDate: deadlineValue,    // TaskController reads "dueDate"
        deadline: deadlineValue,   // DocumentService reads "deadline"
        departmentId: deptEl ? (deptEl.value || null) : null,
        sourceType: 'extension',
        soHieuVanBanGiao: soHieuVanBanGiao,
      });
    }

    if (tasksFromDom.length === 0) { alert('Chọn ít nhất 1 nhiệm vụ (tick checkbox)'); return; }

    if (!confirm(`Bạn có chắc muốn tạo ${tasksFromDom.length} nhiệm vụ?`)) return;

    const btn = documentId !== null
      ? document.getElementById(`vbdh-btn-create-tasks-${documentId}`)
      : document.getElementById(`vbdh-btn-create-tasks-nonThongBao-${docIndex}`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo...'; }

    try {
      const payload = tasksFromDom;
      let created = [];
      let skipped = [];

      if (documentId !== null) {
        // ThongBao: create tasks linked to uploaded document
        const res = await apiPost(`/api/v1/documents/${documentId}/create-tasks`, payload);
        const results = res.data || [];
        for (const r of results) {
          if (r.skipped) { skipped.push(r.title + ' (' + r.reason + ')'); }
          else { created.push(r); }
        }
      } else {
        // Non-ThongBao: create tasks one by one
        for (const item of payload) {
          const res = await apiPost('/api/v1/tasks', item);
          if (res.success !== false && res.data) {
            created.push(res.data);
          } else if (res.message) {
            skipped.push(res.message);
          }
        }
      }

      let msg = `Đã tạo ${created.length} nhiệm vụ thành công!`;
      if (skipped.length > 0) msg += `\n⚠️ ${skipped.length} nhiệm vụ đã tồn tại:\n${skipped.join('\n')}`;
      alert(msg);
      resultEl.innerHTML = `<div class="vbdh-extract-success">✅ Đã tạo ${created.length} nhiệm vụ từ văn bản này.</div>`;
      statusEl.textContent = '✅ Đã tạo NV';
    } catch (e) {
      alert('Tạo nhiệm vụ thất bại: ' + (e.message || 'Lỗi không xác định'));
      const fallbackCount = tasksFromDom.length;
      if (btn) { btn.disabled = false; btn.textContent = `✅ Tạo nhiệm vụ (${fallbackCount})`; }
    }
  }

  async function processNonThongBaoDoc(doc, docIndex) {
    // For non-ThongBao documents: download file → upload → AI summarize → create 1 task
    const title = doc.trichYeu || doc.soKyHieu || 'Văn bản ' + (docIndex + 1);
    const resultEl = document.getElementById(`vbdh-result-${docIndex}-0`);
    const statusEl = document.getElementById(`vbdh-status-${docIndex}-0`);
    const a = window.__vbdhAuth;
    const apiUrl = getApiUrl();

    let aiSummary = '';
    let documentId = null;

    if (a && a.token && doc.files.length > 0) {
      try {
        const file = doc.files[0];
        const cacheKey = generateCacheKey(doc, file);

        // Check cache first
        statusEl.textContent = '⏳ Kiểm tra cache...';
        statusEl.className = 'vbdh-status vbdh-status-pending';
        const cacheResult = await checkCache(apiUrl, cacheKey);

        if (cacheResult.found && cacheResult.documentId) {
          if ((cacheResult.status === 'completed' || cacheResult.status === 'extracted') && cacheResult.extractionResult) {
            aiSummary = cacheResult.extractionResult.summary || cacheResult.extractionResult.raw || '';
            documentId = cacheResult.documentId;
            statusEl.className = 'vbdh-status vbdh-status-done';
            statusEl.textContent = '⚡ Cache';
          } else if (cacheResult.status === 'processing' || cacheResult.status === 'extracting') {
            statusEl.className = 'vbdh-status vbdh-status-pending';
            statusEl.textContent = '⏳ AI đang xử lý...';
            const extractData = await pollUntilDone(apiUrl, cacheResult.documentId, statusEl);
            aiSummary = (extractData.extractionResult && (extractData.extractionResult.summary || extractData.extractionResult.raw)) || '';
            documentId = extractData.documentId || cacheResult.documentId;
          } else if (cacheResult.extractionResult) {
            aiSummary = cacheResult.extractionResult.summary || cacheResult.extractionResult.raw || '';
            documentId = cacheResult.documentId;
            statusEl.className = 'vbdh-status vbdh-status-done';
            statusEl.textContent = '⚡ Cache';
          }
        }

        if (!documentId) {
          // Download file
          statusEl.textContent = '⏳ Đang tải file...';
          const blob = await fetchFile(file.url);
          if (!blob) {
            statusEl.className = 'vbdh-status vbdh-status-error';
            statusEl.textContent = '❌ Lỗi tải file';
            aiSummary = title; // fallback to trichYeu
          } else {
            // Upload to backend
            statusEl.textContent = '⏳ Đang upload...';
            const singleDoc = { ...doc, files: [{ name: file.name }] };
            const formData = new FormData();
            formData.append('metadata', JSON.stringify({ ...singleDoc, cacheKey }));
            formData.append('cacheKey', cacheKey);
            formData.append('files', blob, file.name);

            const uploadRes = await fetchWithRefresh(`${apiUrl}/documents/upload`, { method: 'POST', headers: getAuthHeaders(), body: formData });
            if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);
            const uploadJson = await uploadRes.json();
            const results = uploadJson.data?.results || [];
            const docResult = results[0];
            if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

            documentId = docResult.documentId;
            statusEl.className = 'vbdh-status vbdh-status-pending';
            statusEl.textContent = '⏳ AI đang tóm tắt...';
            const extractData = await pollUntilDone(apiUrl, documentId, statusEl);
            aiSummary = (extractData.extractionResult && (extractData.extractionResult.summary || extractData.extractionResult.raw)) || '';
          }
        }
      } catch (error) {
        console.warn('[VBDH] Non-ThongBao AI summary failed:', error.message);
        aiSummary = title; // fallback to trichYeu
      }
    } else {
      // No auth or no files — fallback to trichYeu
      aiSummary = title;
    }

    if (statusEl) {
      statusEl.className = 'vbdh-status vbdh-status-done';
      statusEl.textContent = '✅ Nhiệm vụ';
    }

    // Push task to extractState — resolve default dept via backend
    // Check if task already exists for this document — if so, preserve user edits
    const existingIdx = extractState.tasks.findIndex(t => t && t._isNonThongBao && t._documentId === documentId);
    const defaultDeptId = await resolveDeptNameToId('', apiUrl);
    if (existingIdx >= 0) {
      // Task already exists — update title/description only, keep user's department/deadline edits
      const existing = extractState.tasks[existingIdx];
      existing.title = title;
      existing.description = aiSummary || title;
    } else {
      const taskIdx = extractState.tasks.length;
    extractState.tasks.push({
      idx: taskIdx,
      title: title,
      description: aiSummary || title,
      departmentName: '',
      department: defaultDeptId || '',
      priority: 'BINH_THUONG',
      deadline: '',
      selected: true,
      _documentId: documentId,
      _isNonThongBao: true,
      _docIndex: docIndex
    });
    } // end else

    if (resultEl) {
      let html = '';
      html += '<div class="vbdh-section-header"><span class="vbdh-section-title">📋 Nhiệm vụ</span></div>';
      const shortDesc = aiSummary ? (aiSummary.length > 100 ? aiSummary.substring(0, 100) + '...' : aiSummary) : '';
      const fullSummary = aiSummary ? escapeHtml(aiSummary) : '';
      html += `<div class="vbdh-extract-info">📝 Đã tóm tắt nội dung văn bản bằng AI.${shortDesc ? ' <i>Tóm tắt: ' + escapeHtml(shortDesc) + '</i>' : ''}${fullSummary ? ' <a href="#" onclick="var d=this.nextElementSibling;d.style.display=d.style.display===\'none\'?\'block\':\'none\';return false;" style="color:#1677ff;cursor:pointer;font-size:12px;">Xem thêm</a><div style="display:none;margin-top:8px;padding:8px;background:#f5f5f5;border-radius:4px;font-size:13px;line-height:1.5;white-space:pre-wrap;">' + fullSummary + '</div>' : ''}</div>`;
      html += '<div class="vbdh-table vbdh-extract-table"><table><thead><tr>';
      html += '<th style="width:36px">✅</th>';
      html += '<th>Nhiệm vụ</th>';
      html += '<th style="width:90px">Ưu tiên</th>';
      html += '<th style="width:130px">Hạn xử lý</th>';
      html += '<th style="width:140px">Phòng ban</th>';
      html += '<th style="width:32px"></th>';
      html += '</tr></thead><tbody>';
      // Use existing task (preserve edits) or newly pushed task
      const actualIdx = existingIdx >= 0 ? existingIdx : (extractState.tasks.length - 1);
      const t = extractState.tasks[actualIdx];
      html += `<tr data-task-idx="${actualIdx}">`;
      html += `<td><input type="checkbox" class="vbdh-extract-check" data-idx="${actualIdx}" ${t.selected ? 'checked' : ''}></td>`;
      html += `<td style="text-align:left"><b class="vbdh-task-title">${escapeHtml(t.title)}</b></td>`;
      html += `<td><select class="vbdh-extract-priority" data-idx="${actualIdx}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;">`;
      html += `<option value="CAO"${t.priority === 'CAO' ? ' selected' : ''}>Cao</option>`;
      html += `<option value="BINH_THUONG"${t.priority === 'BINH_THUONG' ? ' selected' : ''}>Bình thường</option>`;
      html += `<option value="THAP"${t.priority === 'THAP' ? ' selected' : ''}>Thấp</option>`;
      html += '</select></td>';
      html += `<td><input type="date" class="vbdh-extract-deadline" data-idx="${actualIdx}" value="${t.deadline || ''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;"></td>`;
      html += `<td><select class="vbdh-extract-dept" data-idx="${actualIdx}" style="width:100%;padding:4px;font-size:12px;border:1px solid #d0d5dd;border-radius:4px;"><option value="">-- Phòng ban --</option>`;
      for (const dept of extractState.departments) {
        html += `<option value="${dept.id}"${t.department === dept.id ? ' selected' : ''}>${escapeHtml(dept.name)}</option>`;
      }
      html += '</select></td>';
      html += `<td><button class="vbdh-extract-del" data-idx="${actualIdx}" title="Xóa" style="background:none;border:none;color:#ff4d4f;cursor:pointer;font-size:16px;">✕</button></td>`;
      html += '</tr>';
      html += '</tbody></table></div>';
      // Create tasks button
      html += '<div class="vbdh-extract-actions">';
      html += `<button class="vbdh-btn vbdh-btn-primary" id="vbdh-btn-create-tasks-nonThongBao-${docIndex}">✅ Tạo nhiệm vụ (1)</button>`;
      html += '</div>';

      resultEl.innerHTML = html;

      // Bind events
      const resultContainer = resultEl;
      resultContainer.querySelectorAll('.vbdh-extract-check').forEach(cb => {
        cb.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx);
          if (extractState.tasks[idx]) extractState.tasks[idx].selected = e.target.checked;
          updateCreateButtonNonThongBao(docIndex);
        });
      });
      resultContainer.querySelectorAll('.vbdh-extract-priority').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx);
          if (extractState.tasks[idx]) extractState.tasks[idx].priority = e.target.value;
        });
      });
      resultContainer.querySelectorAll('.vbdh-extract-deadline').forEach(inp => {
        inp.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx);
          if (extractState.tasks[idx]) extractState.tasks[idx].deadline = e.target.value;
        });
      });
      resultContainer.querySelectorAll('.vbdh-extract-dept').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.idx);
          if (extractState.tasks[idx]) extractState.tasks[idx].department = e.target.value;
        });
      });
      resultContainer.querySelectorAll('.vbdh-extract-del').forEach(btn => {
        btn.addEventListener('click', e => {
          const idx = parseInt(e.target.dataset.idx);
          extractState.tasks[idx] = null;
          const row = e.target.closest('tr');
          if (row) row.remove();
          updateCreateButtonNonThongBao(docIndex);
        });
      });

      const createBtn = document.getElementById(`vbdh-btn-create-tasks-nonThongBao-${docIndex}`);
      if (createBtn) {
        const currentDocIndex = docIndex;
      createBtn.addEventListener('click', () => handleCreateExtractTasks(null, getApiUrl(), statusEl, resultEl, currentDocIndex));
      }
    }
  }

  function updateCreateButtonNonThongBao(docIndex) {
    const btn = document.getElementById(`vbdh-btn-create-tasks-nonThongBao-${docIndex}`);
    if (!btn) return;
    // Count from DOM checkboxes within the same result container
    const container = btn.closest('[id^="vbdh-result-"]');
    let count = 0;
    if (container) {
      count = Array.from(container.querySelectorAll('.vbdh-extract-check')).filter(cb => cb.checked).length;
    }
    btn.textContent = `✅ Tạo nhiệm vụ (${count})`;
    btn.disabled = count === 0;
  }

  function updateDocFileCounts(docs) {}
  function updateDocTaskBadge(docs, docIndex) {
    const badge = document.getElementById(`vbdh-file-count-${docIndex}`);
    if (!badge) return;
    const docContent = document.getElementById(`vbdh-doc-content-${docIndex}`);
    const taskRows = docContent ? docContent.querySelectorAll('.vbdh-table tbody tr, .vbdh-extract-table tbody tr').length : 0;
    const isThongBao = isExtractableDoc(docs[docIndex]);
    if (isThongBao) {
      badge.textContent = `${docs[docIndex].files.length} file · ${taskRows} nhiệm vụ`;
    } else {
      badge.textContent = `${taskRows} nhiệm vụ`;
    }
  }

  // ===== HELPERS =====

  async function fetchFile(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return await res.blob();
    } catch { return null; }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function generateCacheKey(doc, file) {
    const normalizedFileName = file.name.replace(/(\.signed)+/gi, '');
    return normalizedFileName;
  }

  function formatDate(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDateShort(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('vi-VN');
  }

  // ===================================================================
  // DOCUMENTS PANEL (chỉ CHIEF/ADMIN)
  // ===================================================================

  let docPanelDocs = [];

  async function loadDocumentsPanel(body) {
    body.innerHTML = `
      <div style="padding:16px">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <input id="vbdh-doc-search" type="text" placeholder="Tìm tiêu đề, số hiệu..." style="flex:1;padding:6px 10px;border:1px solid #d9d9d9;border-radius:6px;font-size:13px"/>
          <button id="vbdh-doc-search-btn" class="vbdh-btn" style="background:#1a73e8;color:#fff">Tìm</button>
          <button id="vbdh-doc-refresh-btn" class="vbdh-btn">&#x21ba; Làm mới</button>
          <button id="vbdh-doc-upload-btn" class="vbdh-btn" style="background:#52c41a;color:#fff">⬆ Tải lên văn bản</button>
          <input type="file" id="vbdh-doc-file-input" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" multiple style="display:none"/>
        </div>
        <div id="vbdh-doc-upload-status" style="display:none;margin-bottom:12px;padding:8px 12px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:13px;color:#003a8c"></div>
        <div id="vbdh-doc-list"><div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang tải...</p></div></div>
        <div id="vbdh-doc-pagination" style="display:flex;gap:6px;justify-content:center;margin-top:12px;align-items:center"></div>
      </div>`;

    let currentPage = 0;
    let currentKeyword = '';
    const pageSize = 10;

    // ── helpers ──────────────────────────────────────────────────────────────

    function fmtDate(v) {
      if (!v) return '-';
      const d = new Date(v);
      return isNaN(d) ? v : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    const docStatusLabel = {
      pending: 'Chờ xử lý', processing: 'Đang xử lý', extracting: 'Đang trích xuất',
      extracted: 'Đã trích xuất', classified: 'Đã phân loại', completed: 'Hoàn thành', error: 'Thất bại',
    };
    const docStatusColor = {
      pending: '#999', processing: '#1890ff', extracting: '#1890ff',
      extracted: '#52c41a', classified: '#52c41a', completed: '#52c41a', error: '#ff4d4f',
    };

    function parseExtractionTasks(data) {
      if (!data) return [];
      let inner = data;
      if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) inner = data.data;
      if (inner.tasks && Array.isArray(inner.tasks)) {
        return inner.tasks.map((t, idx) => ({
          idx,
          title: t.title || t.content || t.task || `Nhiệm vụ ${idx + 1}`,
          description: [t.description || t.detail || '', t.deadline ? `Hạn: ${t.deadline}` : ''].filter(Boolean).join('\n'),
          departmentName: t.department || '',
          departmentId: '',
          priority: t.priority === 'urgent' ? 'CAO' : 'BINH_THUONG',
          deadline: t.deadline || t.dueDate || '',
          selected: true,
        }));
      }
      if (inner.task || inner.title) {
        return [{
          idx: 0,
          title: inner.title || inner.task || 'Nhiệm vụ 1',
          description: [inner.description || inner.detail || '', inner.deadline ? `Hạn: ${inner.deadline}` : ''].filter(Boolean).join('\n'),
          departmentName: inner.department || '',
          departmentId: '',
          priority: inner.priority === 'urgent' ? 'CAO' : 'BINH_THUONG',
          deadline: inner.deadline || '',
          selected: true,
        }];
      }
      if (inner.raw) return [{ idx: 0, title: inner.raw.substring(0, 300), description: '', departmentName: '', departmentId: '', priority: 'BINH_THUONG', deadline: '', selected: true }];
      return [];
    }

    async function resolveDeptsBatch(tasks) {
      if (!tasks.length) return tasks;
      try {
        const res = await apiPost('/api/v1/departments/resolve-batch', { names: tasks.map(t => t.departmentName || '') });
        const results = res.data || [];
        return tasks.map((t, i) => ({ ...t, departmentId: results[i]?.departmentId || '' }));
      } catch { return tasks; }
    }

    // AI suggest phòng ban cho task chưa match (giống autoSuggestDepartments web tbkl)
    async function aiSuggestDepartments(doc, tasks) {
      if (!tasks.length) return;
      await ensureDepartmentsLoaded();
      const deptNames = (extractState.departments || []).map(d => d.name);
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].departmentId) continue;
        try {
          const res = await apiPost('/api/v1/ai/suggest-department', { title: tasks[i].title, departments: deptNames });
          const sug = res.data;
          if (sug?.department) {
            const dept = (extractState.departments || []).find(d => d.name === sug.department);
            tasks[i].departmentId = dept?.id || '';
            tasks[i].departmentName = sug.department;
            if (sug.priority && sug.priority !== 'BINH_THUONG') tasks[i].priority = sug.priority;
          }
        } catch { /* skip — giữ fallback của backend */ }
      }
      // Re-render nếu modal còn mở
      const sub = document.getElementById('vbdh-extract-modal');
      if (sub && extractTasks.length) renderExtractTasks(sub, extractTasks, doc);
    }

    // ── extract & polling ─────────────────────────────────────────────────────

    async function doExtract(doc, reExtract = false) {
      showExtractModal(doc, null, [], true);
      try {
        const endpoint = reExtract
          ? `/api/v1/documents/${doc.id}/re-extract`
          : `/api/v1/documents/${doc.id}/extract`;
        const res = await apiPost(endpoint, {});
        const data = res.data;
        if (data?.status === 'no_text') {
          updateExtractModal(doc, null, [], false, '⚠️ Văn bản chưa có nội dung trích xuất');
          return;
        }
        if (data?.status === 'extracting' || data?.status === 'processing') {
          updateExtractModal(doc, null, [], true, '⏳ Đang trích xuất, vui lòng chờ...');
          pollExtract(doc);
          return;
        }
        const tasks = await resolveDeptsBatch(parseExtractionTasks(data));
        updateExtractModal(doc, data, tasks, false, null);
        aiSuggestDepartments(doc, tasks);
      } catch (e) {
        updateExtractModal(doc, null, [], false, '❌ Trích xuất thất bại: ' + e.message);
      }
    }

    function pollExtract(doc, attempts = 0) {
      if (attempts >= 60) {
        updateExtractModal(doc, null, [], false, '⚠️ Timeout — chưa hoàn tất sau 5 phút');
        return;
      }
      setTimeout(async () => {
        try {
          const res = await apiGet(`/api/v1/documents/${doc.id}`);
          const d = res.data;
          if (d?.status === 'extracted' && d?.extractionResult) {
            const tasks = await resolveDeptsBatch(parseExtractionTasks(d.extractionResult));
            updateExtractModal(doc, d.extractionResult, tasks, false, null);
            aiSuggestDepartments(doc, tasks);
            return;
          }
          if (d?.status === 'error' || d?.status === 'pending') {
            updateExtractModal(doc, null, [], false, '❌ Trích xuất thất bại');
            return;
          }
        } catch {}
        pollExtract(doc, attempts + 1);
      }, 5000);
    }

    // ── extract modal ─────────────────────────────────────────────────────────

    let extractTasks = []; // reactive state bên ngoài DOM
    let extractDocRef = null;

    function showExtractModal(doc, extractData, tasks, loading, msg) {
      extractDocRef = doc;
      extractTasks = tasks;

      const existing = document.getElementById('vbdh-extract-modal');
      if (existing) existing.remove();

      const sub = document.createElement('div');
      sub.id = 'vbdh-extract-modal';
      sub.className = 'vbdh-sub-modal';
      sub.innerHTML = `
        <div class="vbdh-sub-overlay"></div>
        <div class="vbdh-sub-container" style="max-width:1100px;width:95%">
          <div class="vbdh-sub-header">
            <h3>🤖 Trích xuất: ${(doc.title || doc.originalFilename || '').substring(0, 60)}</h3>
            <button class="vbdh-close">&times;</button>
          </div>
          <div class="vbdh-modal-body" id="vbdh-extract-body">
            ${loading ? '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang trích xuất...</p></div>' : ''}
            ${msg ? `<p style="color:#f5a623;padding:12px">${msg}</p>` : ''}
          </div>
          <div id="vbdh-extract-footer" style="padding:12px 20px;border-top:1px solid #e8e8e8;display:flex;gap:8px;justify-content:flex-end">
            ${!loading && !msg ? renderExtractFooterBtns(doc) : ''}
          </div>
        </div>`;

      sub.querySelector('.vbdh-sub-overlay').onclick = () => sub.remove();
      sub.querySelector('.vbdh-close').onclick = () => sub.remove();
      document.getElementById('vbdh-assistant-modal').appendChild(sub);

      if (!loading && tasks.length > 0) renderExtractTasks(sub, tasks, doc);
      bindExtractFooter(sub, doc);
    }

    function updateExtractModal(doc, extractData, tasks, loading, msg) {
      extractTasks = tasks;
      const sub = document.getElementById('vbdh-extract-modal');
      if (!sub) { showExtractModal(doc, extractData, tasks, loading, msg); return; }

      const bodyEl = document.getElementById('vbdh-extract-body');
      const footerEl = document.getElementById('vbdh-extract-footer');

      if (loading) {
        bodyEl.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang trích xuất...</p></div>';
        footerEl.innerHTML = '';
        return;
      }
      if (msg) {
        bodyEl.innerHTML = `<p style="color:#f5a623;padding:12px">${msg}</p>`;
        footerEl.innerHTML = '';
        return;
      }
      bodyEl.innerHTML = '';
      if (tasks.length > 0) renderExtractTasks(sub, tasks, doc);
      else bodyEl.innerHTML = '<p style="color:#999;padding:16px;text-align:center">Không trích xuất được nhiệm vụ nào</p>';

      footerEl.innerHTML = renderExtractFooterBtns(doc);
      bindExtractFooter(sub, doc);
    }

    function renderExtractFooterBtns(doc) {
      return `
        <button id="vbdh-re-extract-btn" class="vbdh-btn">🔄 Trích xuất lại</button>
        <button id="vbdh-create-tasks-btn" class="vbdh-btn" style="background:#52c41a;color:#fff">✅ Tạo nhiệm vụ đã chọn</button>`;
    }

    function bindExtractFooter(sub, doc) {
      const reBtn = sub.querySelector('#vbdh-re-extract-btn');
      const createBtn = sub.querySelector('#vbdh-create-tasks-btn');
      if (reBtn) reBtn.onclick = () => doExtract(doc, true);
      if (createBtn) createBtn.onclick = () => createSelectedTasks(doc, sub);
    }

    function renderExtractTasks(sub, tasks, doc) {
      const bodyEl = document.getElementById('vbdh-extract-body');
      const depts = (extractState.departments || []);
      if (depts.length === 0) ensureDepartmentsLoaded().then(() => { if (extractState.departments.length) renderExtractTasks(sub, extractTasks, doc); });

      const deptOptions = (sel) => depts.map(d =>
        `<option value="${d.id}" ${sel === d.id ? 'selected' : ''}>${escHtml(d.name)}</option>`).join('');

      // Cột theo đúng thứ tự web tbkl: ✅ | Tiêu đề | Mô tả | Ưu tiên | Hạn xử lý | Phòng ban (select) | ✕
      const rows = tasks.map((t, i) => `
        <tr>
          <td style="padding:6px;text-align:center;vertical-align:top"><input type="checkbox" class="vbdh-task-chk" data-idx="${i}" ${t.selected ? 'checked' : ''}></td>
          <td style="padding:6px;vertical-align:top;width:30%">
            <textarea class="vbdh-task-title" data-idx="${i}" rows="3"
              style="width:100%;max-width:100%;box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;padding:4px 6px;font-size:13px;resize:vertical">${escHtml(t.title)}</textarea>
          </td>
          <td style="padding:6px;vertical-align:top;width:30%">
            <textarea class="vbdh-task-desc" data-idx="${i}" rows="3"
              style="width:100%;max-width:100%;box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;padding:4px 6px;font-size:13px;resize:vertical">${escHtml(t.description || '')}</textarea>
          </td>
          <td style="padding:6px;vertical-align:top;white-space:nowrap">
            <select class="vbdh-task-priority" data-idx="${i}" style="box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;padding:4px;font-size:12px;max-width:100px">
              <option value="CAO" ${t.priority==='CAO'?'selected':''}>Cao</option>
              <option value="BINH_THUONG" ${t.priority==='BINH_THUONG'?'selected':''}>Bình thường</option>
              <option value="THAP" ${t.priority==='THAP'?'selected':''}>Thấp</option>
            </select>
          </td>
          <td style="padding:6px;vertical-align:top;white-space:nowrap">
            <input class="vbdh-task-deadline" data-idx="${i}" type="date" value="${t.deadline ? t.deadline.substring(0,10) : ''}"
              style="box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;padding:4px;font-size:12px"/>
          </td>
          <td style="padding:6px;vertical-align:top;width:22%">
            <select class="vbdh-task-dept" data-idx="${i}" style="width:100%;max-width:100%;box-sizing:border-box;border:1px solid #d9d9d9;border-radius:4px;padding:4px;font-size:12px">
              <option value="">-- Chọn phòng ban --</option>
              ${deptOptions(t.departmentId)}
            </select>
          </td>
          <td style="padding:6px;text-align:center;vertical-align:top">
            <button class="vbdh-task-del" data-idx="${i}" title="Xóa dòng"
              style="border:none;background:none;color:#ff4d4f;cursor:pointer;font-size:14px">&times;</button>
          </td>
        </tr>`).join('');

      bodyEl.innerHTML = `
        <p style="font-size:12px;color:#1890ff;background:#e6f7ff;padding:8px 12px;border-radius:4px;margin-bottom:8px">
          ℹ️ Chọn nhiệm vụ, điền thông tin, rồi bấm "Tạo nhiệm vụ"</p>
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px;table-layout:fixed">
          <colgroup>
            <col style="width:36px">
            <col style="width:30%">
            <col style="width:30%">
            <col style="width:110px">
            <col style="width:140px">
            <col style="width:22%">
            <col style="width:32px">
          </colgroup>
          <thead>
            <tr style="background:#fafafa">
              <th style="padding:6px"><input type="checkbox" id="vbdh-chk-all" checked title="Chọn tất cả"></th>
              <th style="padding:6px;text-align:left">Tiêu đề</th>
              <th style="padding:6px;text-align:left">Mô tả</th>
              <th style="padding:6px;text-align:left;white-space:nowrap">Ưu tiên</th>
              <th style="padding:6px;text-align:left;white-space:nowrap">Hạn xử lý</th>
              <th style="padding:6px;text-align:left">Phòng ban</th>
              <th style="padding:6px"></th>
            </tr>
          </thead>
          <tbody id="vbdh-extract-tbody">${rows}</tbody>
        </table>
        </div>`;

      // Chọn tất cả
      const chkAll = bodyEl.querySelector('#vbdh-chk-all');
      if (chkAll) chkAll.onchange = e => {
        bodyEl.querySelectorAll('.vbdh-task-chk').forEach(c => { c.checked = e.target.checked; extractTasks[+c.dataset.idx].selected = e.target.checked; });
      };
      bodyEl.querySelectorAll('.vbdh-task-chk').forEach(c => c.onchange = e => { extractTasks[+c.dataset.idx].selected = e.target.checked; });
      bodyEl.querySelectorAll('.vbdh-task-title').forEach(i => i.oninput = e => { extractTasks[+i.dataset.idx].title = e.target.value; });
      bodyEl.querySelectorAll('.vbdh-task-desc').forEach(i => i.oninput = e => { extractTasks[+i.dataset.idx].description = e.target.value; });
      bodyEl.querySelectorAll('.vbdh-task-dept').forEach(sl => sl.onchange = e => { extractTasks[+sl.dataset.idx].departmentId = e.target.value; });
      bodyEl.querySelectorAll('.vbdh-task-priority').forEach(s => s.onchange = e => { extractTasks[+s.dataset.idx].priority = e.target.value; });
      bodyEl.querySelectorAll('.vbdh-task-deadline').forEach(i => i.onchange = e => { extractTasks[+i.dataset.idx].deadline = e.target.value; });
      bodyEl.querySelectorAll('.vbdh-task-del').forEach(b => b.onclick = () => {
        extractTasks.splice(+b.dataset.idx, 1);
        extractTasks.forEach((t, i) => t.idx = i);
        renderExtractTasks(sub, extractTasks, doc);
      });
    }

    function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    async function createSelectedTasks(doc, sub) {
      const selected = extractTasks.filter(t => t.selected);
      if (!selected.length) { alert('⚠️ Chọn ít nhất 1 nhiệm vụ'); return; }

      // Resolve department names to IDs trước khi tạo
      const resolved = await resolveDeptsBatch(selected);

      const btn = sub.querySelector('#vbdh-create-tasks-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo...'; }
      try {
        const payload = resolved.map(t => ({
          title: t.title,
          description: t.description || '',
          departmentId: t.departmentId || null,
          priority: t.priority || 'BINH_THUONG',
          deadline: t.deadline || null,
        }));
        const res = await apiPost(`/api/v1/documents/${doc.id}/create-tasks`, payload);
        const created = res.data || [];
        alert(`✅ Đã tạo ${created.length} nhiệm vụ thành công!`);
        sub.remove();
        loadPage(currentPage); // refresh list
      } catch (e) {
        alert('❌ Tạo nhiệm vụ thất bại: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '✅ Tạo nhiệm vụ đã chọn'; }
      }
    }

    // ── show existing tasks ────────────────────────────────────────────────────

    async function showExistingTasks(doc) {
      const sub = document.createElement('div');
      sub.id = 'vbdh-doc-tasks-modal';
      sub.className = 'vbdh-sub-modal';
      sub.innerHTML = `
        <div class="vbdh-sub-overlay"></div>
        <div class="vbdh-sub-container" style="max-width:700px">
          <div class="vbdh-sub-header">
            <h3>📋 Nhiệm vụ từ: ${(doc.title || '').substring(0, 50)}</h3>
            <button class="vbdh-close">&times;</button>
          </div>
          <div class="vbdh-modal-body">
            <div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang tải...</p></div>
          </div>
        </div>`;
      sub.querySelector('.vbdh-sub-overlay').onclick = () => sub.remove();
      sub.querySelector('.vbdh-close').onclick = () => sub.remove();
      document.getElementById('vbdh-assistant-modal').appendChild(sub);

      try {
        const res = await apiGet(`/api/v1/documents/${doc.id}/tasks`);
        const tasks = res.data || [];
        const mbody = sub.querySelector('.vbdh-modal-body');
        if (!tasks.length) { mbody.innerHTML = '<p style="color:#999;text-align:center;padding:24px">Chưa có nhiệm vụ nào</p>'; return; }

        const taskStatusLabel = { assigned:'Chờ PC', dept_assigned:'Đã PC NV', in_progress:'Đang TH', pending_review:'Chờ duyệt', dept_rejected:'Bị trả lại', completed:'Hoàn thành', cancelled:'Đã hủy' };
        const taskStatusColor = { assigned:'#faad14', dept_assigned:'#1890ff', in_progress:'#fa8c16', pending_review:'#722ed1', dept_rejected:'#ff4d4f', completed:'#52c41a', cancelled:'#999' };

        const rows = tasks.map(t => {
          const sc = taskStatusColor[t.status] || '#999';
          const sl = taskStatusLabel[t.status] || t.status;
          return `<tr>
            <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.title)}">${escHtml(t.title)}</td>
            <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0"><span style="background:${sc}22;color:${sc};padding:2px 6px;border-radius:4px;font-size:11px">${sl}</span></td>
            <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:12px">${t.progress ?? 0}%</td>
            <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:12px">${fmtDate(t.deadline)}</td>
          </tr>`;
        }).join('');

        mbody.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#fafafa">
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Tiêu đề</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Trạng thái</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Tiến độ</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Hạn</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      } catch (e) {
        const mbody = sub.querySelector('.vbdh-modal-body');
        if (mbody) mbody.innerHTML = `<p style="color:red;padding:16px">❌ ${e.message}</p>`;
      }
    }

    // ── detail modal ──────────────────────────────────────────────────────────

    function showDocDetail(d) {
      const existing = document.getElementById('vbdh-doc-detail-modal');
      if (existing) existing.remove();

      const apiBase = getApiBase();
      const status = docStatusLabel[d.status] || d.status;
      const color = docStatusColor[d.status] || '#999';
      const hasExtraction = !!d.extractionResult;

      const sub = document.createElement('div');
      sub.id = 'vbdh-doc-detail-modal';
      sub.className = 'vbdh-sub-modal';
      sub.innerHTML = `
        <div class="vbdh-sub-overlay"></div>
        <div class="vbdh-sub-container" style="max-width:620px">
          <div class="vbdh-sub-header">
            <h3>📄 Chi tiết văn bản</h3>
            <button class="vbdh-close">&times;</button>
          </div>
          <div class="vbdh-modal-body">
            <div class="vbdh-detail-grid">
              <div class="vbdh-detail-row"><b>Tiêu đề:</b> ${d.title || d.originalFilename || '-'}</div>
              <div class="vbdh-detail-row"><b>Số hiệu:</b> ${d.documentNumber || '-'}</div>
              <div class="vbdh-detail-row"><b>Ngày văn bản:</b> ${fmtDate(d.documentDate)}</div>
              <div class="vbdh-detail-row"><b>Ngày nhận:</b> ${fmtDate(d.receivedDate)}</div>
              <div class="vbdh-detail-row"><b>Loại file:</b> ${d.fileType || '-'} &nbsp; <b>Kích thước:</b> ${d.fileSizeKb ? d.fileSizeKb + ' KB' : '-'}</div>
              <div class="vbdh-detail-row"><b>Trạng thái:</b> <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:4px;font-size:12px">${status}</span></div>
              <div class="vbdh-detail-row"><b>Nguồn:</b> ${d.source || '-'}</div>
              <div class="vbdh-detail-row"><b>Ngày tạo:</b> ${d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : '-'}</div>
              ${d.description ? `<div class="vbdh-detail-row"><b>Mô tả:</b> ${d.description}</div>` : ''}
            </div>
            <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
              <button id="vbdh-detail-dl-btn" class="vbdh-btn" style="background:#1a73e8;color:#fff">↓ Tải file</button>
              <button id="vbdh-detail-extract-btn" class="vbdh-btn" style="background:#722ed1;color:#fff">
                🤖 ${hasExtraction ? 'Xem trích xuất' : 'Trích xuất'}
              </button>
              <button id="vbdh-detail-tasks-btn" class="vbdh-btn">📋 Xem nhiệm vụ</button>
            </div>
          </div>
        </div>`;

      sub.querySelector('.vbdh-sub-overlay').onclick = () => sub.remove();
      sub.querySelector('.vbdh-close').onclick = () => sub.remove();
      sub.querySelector('#vbdh-detail-dl-btn').onclick = () => downloadDocFile(d.id, d.title || d.originalFilename);
      sub.querySelector('#vbdh-detail-extract-btn').onclick = () => { sub.remove(); doExtract(d); };
      sub.querySelector('#vbdh-detail-tasks-btn').onclick = () => { sub.remove(); showExistingTasks(d); };
      document.getElementById('vbdh-assistant-modal').appendChild(sub);
    }

    // ── list render ───────────────────────────────────────────────────────────

    function getDocActions(d) {
      const isProcessing = d.status === 'processing' || d.status === 'extracting';
      const hasExtraction = !!d.extractionResult;
      const hasTasksFlag = !!d._taskCount;

      let extractLabel = '🤖 Trích xuất';
      if (isProcessing) extractLabel = '⏳ Đang xử lý';
      else if (hasTasksFlag) extractLabel = '📋 Xem NV';
      else if (hasExtraction) extractLabel = '📄 Xem trích xuất';

      return `
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="vbdh-btn vbdh-btn-sm vbdh-extract-btn" data-id="${d.id}"
            style="background:#722ed1;color:#fff" ${isProcessing ? 'disabled' : ''}>${extractLabel}</button>
          <button class="vbdh-btn vbdh-btn-sm vbdh-detail-btn" data-id="${d.id}">Chi tiết</button>
        </div>`;
    }

    function renderDocs(pageData, taskCounts) {
      const list = document.getElementById('vbdh-doc-list');
      const pagination = document.getElementById('vbdh-doc-pagination');
      if (!list) return;

      const docs = pageData?.content || [];
      if (!docs.length) {
        list.innerHTML = '<p style="color:#999;text-align:center;padding:24px">Không có văn bản nào</p>';
        pagination.innerHTML = '';
        return;
      }

      // Gán task count vào doc object để dùng trong getDocActions
      const docsWithCount = docs.map(d => ({ ...d, _taskCount: taskCounts?.[d.id] || 0 }));
      docPanelDocs = docs;

      const rows = docsWithCount.map(d => {
        const color = docStatusColor[d.status] || '#999';
        let statusHtml;
        if (d._taskCount) statusHtml = `<span style="background:#1890ff22;color:#1890ff;padding:2px 6px;border-radius:4px;font-size:11px">📋 ${d._taskCount} nhiệm vụ</span>`;
        else if (d.extractionResult) statusHtml = `<span style="background:#52c41a22;color:#52c41a;padding:2px 6px;border-radius:4px;font-size:11px">✅ Đã trích xuất</span>`;
        else statusHtml = `<span style="background:${color}22;color:${color};padding:2px 6px;border-radius:4px;font-size:11px">${docStatusLabel[d.status] || d.status}</span>`;

        return `<tr data-id="${d.id}">
          <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(d.title || '')}">${escHtml(d.title || d.originalFilename || '-')}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:12px;white-space:nowrap">${fmtDate(d.receivedDate || d.createdAt)}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0">${statusHtml}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0">${getDocActions(d)}</td>
        </tr>`;
      }).join('');

      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#fafafa">
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Tiêu đề</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8;white-space:nowrap">Ngày nhận</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Trạng thái</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e8e8e8">Thao tác</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

      // Bind buttons (after render)
      list.querySelectorAll('.vbdh-extract-btn').forEach(btn => {
        btn.onclick = async () => {
          const docId = btn.dataset.id;
          const doc = docsWithCount.find(d => d.id === docId);
          if (!doc) return;
          if (doc._taskCount) { showExistingTasks(doc); return; }
          doExtract(doc, false);
        };
      });
      list.querySelectorAll('.vbdh-detail-btn').forEach(btn => {
        btn.onclick = async () => {
          const docId = btn.dataset.id;
          try {
            const res = await apiGet(`/api/v1/documents/${docId}`);
            showDocDetail(res.data);
          } catch (e) { alert('❌ ' + e.message); }
        };
      });

      // Pagination
      const total = pageData.totalElements || 0;
      const totalPages = pageData.totalPages || 1;
      const cur = pageData.number || 0;
      if (totalPages <= 1) { pagination.innerHTML = `<span style="font-size:12px;color:#999">Tổng: ${total} văn bản</span>`; return; }
      let pagBtns = `<span style="font-size:12px;color:#999;margin-right:6px">${total} văn bản</span>`;
      pagBtns += `<button class="vbdh-btn vbdh-btn-sm" ${cur === 0 ? 'disabled' : ''} data-pg="${cur - 1}">‹</button>`;
      pagBtns += `<span style="font-size:12px;padding:0 6px">${cur + 1} / ${totalPages}</span>`;
      pagBtns += `<button class="vbdh-btn vbdh-btn-sm" ${cur >= totalPages - 1 ? 'disabled' : ''} data-pg="${cur + 1}">›</button>`;
      pagination.innerHTML = pagBtns;
      pagination.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => loadPage(+b.dataset.pg));
    }

    // ── fetch & load ──────────────────────────────────────────────────────────

    async function loadPage(page) {
      currentPage = page;
      const list = document.getElementById('vbdh-doc-list');
      if (list) list.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang tải...</p></div>';
      try {
        const params = new URLSearchParams({ page, size: pageSize, source: 'extension' });
        if (currentKeyword) params.append('keyword', currentKeyword);
        const [docsRes, countsRes] = await Promise.all([
          apiGet(`/api/v1/documents?${params}`),
          apiGet('/api/v1/documents/task-counts').catch(() => ({ data: {} })),
        ]);
        renderDocs(docsRes.data, countsRes.data);
      } catch (e) {
        if (list) list.innerHTML = `<p style="color:red;padding:16px">❌ Lỗi tải văn bản: ${e.message}</p>`;
      }
    }

    // ── search ────────────────────────────────────────────────────────────────

    const searchInput = document.getElementById('vbdh-doc-search');
    const searchBtn = document.getElementById('vbdh-doc-search-btn');
    const refreshBtn = document.getElementById('vbdh-doc-refresh-btn');
    const doSearch = () => { currentKeyword = searchInput ? searchInput.value.trim() : ''; loadPage(0); };
    if (searchBtn) searchBtn.onclick = doSearch;
    if (refreshBtn) refreshBtn.onclick = () => { if (searchInput) searchInput.value = ''; currentKeyword = ''; loadPage(0); };

    // Upload văn bản từ máy — dùng endpoint extension (xử lý AI luôn)
    const uploadBtn = document.getElementById('vbdh-doc-upload-btn');
    const fileInput = document.getElementById('vbdh-doc-file-input');
    const uploadStatus = document.getElementById('vbdh-doc-upload-status');
    const showUpStatus = (msg, isError) => {
      uploadStatus.style.display = 'block';
      uploadStatus.style.background = isError ? '#fff1f0' : '#f0f5ff';
      uploadStatus.style.borderColor = isError ? '#ffa39e' : '#adc6ff';
      uploadStatus.style.color = isError ? '#cf1322' : '#003a8c';
      uploadStatus.innerHTML = msg;
    };
    if (uploadBtn && fileInput) {
      uploadBtn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;
        showUpStatus(`⏳ Đang tải lên ${files.length} file...`, false);
        uploadBtn.disabled = true;
        try {
          const fd = new FormData();
          files.forEach(f => fd.append('files', f, f.name));
          const res = await fetchWithRefresh(getApiUrl() + '/documents/upload', { method: 'POST', headers: getAuthHeaders(), body: fd });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = await res.json();
          const results = json.data?.results || [];
          const okCount = results.filter(r => !r.error).length;
          const errHtml = results.filter(r => r.error).map(r => `<div>❌ ${r.fileName}: ${r.error}</div>`).join('');
          showUpStatus(`✅ Đã tải lên ${okCount}/${files.length} file — AI đang xử lý.${errHtml}`, false);
          loadPage(0);
        } catch (e) {
          showUpStatus('❌ Tải lên thất bại: ' + (e.message || e), true);
        } finally {
          uploadBtn.disabled = false;
          fileInput.value = '';
        }
      };
    }
    if (searchInput) searchInput.onkeydown = e => { if (e.key === 'Enter') doSearch(); };

    loadPage(0);

    // Auto-poll khi có văn bản đang processing/extracting (giống web tbkl)
    let pollTimer = null;
    setInterval(() => {
      const hasProcessing = (docPanelDocs || []).some(d => d.status === 'processing' || d.status === 'extracting');
      if (hasProcessing && !pollTimer) pollTimer = setInterval(() => loadPage(currentPage), 3000);
      else if (!hasProcessing && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }, 4000);
  }

  // ===== CSS =====

  function getVbdhCSS() {
    return `
      #vbdh-assistant-modal { position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .vbdh-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); }
      .vbdh-container { position:relative; width:94%; max-width:1200px; max-height:88vh; background:#fff; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3); text-align:left; }
      .vbdh-header { display:flex; justify-content:space-between; align-items:center; padding:14px 24px; border-bottom:2px solid #1a73e8; }
      .vbdh-header h2 { margin:0; font-size:17px; color:#1a73e8; display:flex; align-items:center; gap:10px; }
      .vbdh-role-badge { font-size:11px; padding:3px 10px; border-radius:10px; font-weight:500; }
      .vbdh-role-leader { background:#f3e5f5; color:#7b1fa2; }
      .vbdh-role-admin { background:#e8f5e9; color:#2e7d32; }
      .vbdh-role-dept_head { background:#e3f2fd; color:#1565c0; }
      .vbdh-role-staff { background:#fff3e0; color:#e65100; }
      .vbdh-close { background:none; border:none; font-size:28px; cursor:pointer; color:#666; padding:0 8px; }
      .vbdh-close:hover { color:#333; background:#f0f0f0; border-radius:4px; }
      .vbdh-body { padding:16px 24px; overflow-y:auto; flex:1; text-align:left; }
      .vbdh-loading,.vbdh-empty { text-align:center; padding:40px; color:#666; }
      .vbdh-spinner { width:36px; height:36px; border:4px solid #e8e8e8; border-top-color:#1a73e8; border-radius:50%; animation:vbdh-spin 1s linear infinite; margin:0 auto 12px; }
      @keyframes vbdh-spin { to { transform:rotate(360deg); } }

      /* Tabs */
      .vbdh-tabs { display:flex; border-bottom:2px solid #e8e8e8; padding:0 24px; }
      .vbdh-tab { padding:10px 24px; border:none; background:none; cursor:pointer; font-size:14px; color:#666; border-bottom:3px solid transparent; margin-bottom:-2px; transition:all 0.15s; }
      .vbdh-tab:hover { color:#1a73e8; }
      .vbdh-tab.active { color:#1a73e8; font-weight:600; border-bottom-color:#1a73e8; }

      /* Doc accordion */
      .vbdh-doc-accordion { border:1px solid #d0d5dd; border-radius:8px; margin-bottom:12px; overflow:hidden; }
      .vbdh-doc-header { display:flex; align-items:center; gap:10px; padding:12px 16px; background:#f0f4f8; cursor:pointer; user-select:none; }
      .vbdh-doc-header:hover { background:#e4eaf0; }
      .vbdh-doc-title { flex:1; font-size:14px; }
      .vbdh-file-count { font-size:11px; background:#d0e3f7; color:#1565c0; padding:2px 8px; border-radius:10px; margin-left:8px; }
      .vbdh-doc-content { border-top:1px solid #d0d5dd; padding:12px 16px; }
      .vbdh-doc-info { display:flex; flex-wrap:wrap; gap:6px 24px; font-size:13px; color:#555; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #eee; }

      .vbdh-file-item { border:1px solid #e2e6ea; border-radius:6px; margin-bottom:8px; overflow:hidden; }
      .vbdh-file-header { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#fafbfc; cursor:pointer; user-select:none; }
      .vbdh-file-header:hover { background:#f0f2f5; }
      .vbdh-file-icon { font-size:16px; }
      .vbdh-file-name { flex:1; font-size:13px; color:#333; }
      .vbdh-file-content { border-top:1px solid #e2e6ea; padding:14px 16px; }

      .vbdh-status { font-size:11px; padding:3px 10px; border-radius:10px; white-space:nowrap; }
      .vbdh-status-pending { background:#fff3e0; color:#e65100; }
      .vbdh-status-done { background:#e8f5e9; color:#2e7d32; }
      .vbdh-status-error { background:#ffebee; color:#c62828; }

      .vbdh-summary-line { font-size:13px; color:#333; line-height:1.6; padding:8px 0 10px 0; margin-bottom:10px; border-bottom:1px solid #eee; }
      .vbdh-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .vbdh-section-title { font-weight:600; font-size:14px; color:#1a73e8; }
      .vbdh-btn-reprocess { width:32px; height:32px; border:1px solid #d0d5dd; background:#fff; border-radius:6px; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; }
      .vbdh-btn-reprocess:hover { background:#fff3e0; }
      .vbdh-btn-reprocess:disabled { opacity:0.5; cursor:not-allowed; }

      .vbdh-table { width:100%; border-collapse:collapse; font-size:13px; }
      .vbdh-table th { background:#f0f4f8; padding:8px 10px; text-align:left; font-weight:600; color:#333; border:1px solid #d0d5dd; white-space:nowrap; }
      .vbdh-table td { padding:8px 10px; border:1px solid #d0d5dd; vertical-align:middle; }
      .vbdh-table tbody tr:hover td { background:#f7f9fc; }

      .vbdh-dept-name { color:#1565c0; font-weight:500; }
      .vbdh-dept-empty { color:#bbb; }
      .vbdh-task-desc { font-size:12px; color:#666; margin-top:4px; line-height:1.5; border-top:1px dashed #e0e0e0; padding-top:4px; }
      .vbdh-no-data { font-size:13px; color:#999; padding:8px 0; }
      .vbdh-extract-info { font-size:12px; color:#666; margin-bottom:8px; padding:6px 10px; background:#f0f7ff; border-radius:4px; }
      .vbdh-extract-table th { font-size:12px; }
      .vbdh-extract-table td { vertical-align:middle; }
      .vbdh-extract-actions { margin-top:12px; text-align:right; }
      .vbdh-extract-success { text-align:center; padding:20px; font-size:14px; color:#2e7d32; background:#e8f5e9; border-radius:8px; }
      .vbdh-error { color:#c62828; padding:12px; background:#ffebee; border-radius:6px; font-size:13px; }
      .vbdh-result-loading { text-align:center; padding:20px; }
      .vbdh-arrow { font-size:11px; color:#888; width:14px; text-align:center; }

      /* Task management */
      .vbdh-task-top-bar { margin-bottom:12px; display:flex; gap:8px; }
      .vbdh-status-tabs { display:flex; gap:4px; margin-bottom:12px; flex-wrap:wrap; border-bottom:1px solid #e8e8e8; padding-bottom:8px; }
      .vbdh-status-tab { padding:6px 14px; border:1px solid #d0d5dd; border-radius:16px; background:#fff; cursor:pointer; font-size:12px; color:#666; transition:all 0.15s; }
      .vbdh-status-tab:hover { background:#f0f4f8; color:#1a73e8; }
      .vbdh-status-tab.active { background:#1a73e8; color:#fff; border-color:#1a73e8; }

      .vbdh-status-tag { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:500; white-space:nowrap; }
      .vbdh-priority { font-weight:600; font-size:12px; }

      .vbdh-progress-bar { display:inline-block; width:80px; height:8px; background:#e8e8e8; border-radius:4px; overflow:hidden; vertical-align:middle; }
      .vbdh-progress-fill { height:100%; border-radius:4px; transition:width 0.3s; }
      .vbdh-progress-text { font-size:11px; color:#666; margin-left:4px; }

      .vbdh-actions { white-space:nowrap; }
      .vbdh-actions .vbdh-btn { margin:2px; }

      .vbdh-btn { padding:5px 12px; border:1px solid #d0d5dd; border-radius:6px; background:#fff; cursor:pointer; font-size:12px; transition:all 0.15s; }
      .vbdh-btn:hover { background:#f0f4f8; }
      .vbdh-btn-sm { padding:3px 8px; font-size:11px; }
      .vbdh-btn-primary { background:#1a73e8; color:#fff; border-color:#1a73e8; }
      .vbdh-btn-primary:hover { background:#1557b0; }
      .vbdh-btn-danger { color:#e53935; }
      .vbdh-btn-danger:hover { background:#ffebee; }
      .vbdh-btn:disabled { opacity:0.5; cursor:not-allowed; }

      .vbdh-pagination { display:flex; justify-content:space-between; align-items:center; padding:12px 0; font-size:13px; color:#666; }

      /* Forms */
      .vbdh-form-group { margin-bottom:14px; }
      .vbdh-form-group label { display:block; font-weight:600; margin-bottom:4px; font-size:13px; color:#333; }
      .vbdh-form-row { display:flex; gap:16px; }
      .vbdh-form-row .vbdh-form-group { flex:1; }
      .vbdh-input { width:100%; padding:8px 12px; border:1px solid #d0d5dd; border-radius:6px; font-size:13px; box-sizing:border-box; }
      .vbdh-input:focus { outline:none; border-color:#1a73e8; box-shadow:0 0 0 2px rgba(26,115,232,0.15); }
      .vbdh-required { color:#e53935; }
      .vbdh-hint { font-size:11px; color:#999; margin-top:2px; display:block; }
      .vbdh-form-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:12px; border-top:1px solid #eee; }

      .vbdh-slider { width:100%; height:6px; -webkit-appearance:none; background:#e8e8e8; border-radius:4px; outline:none; }
      .vbdh-slider::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:#1a73e8; cursor:pointer; }
      .vbdh-progress-info { padding:8px 12px; background:#f0f5ff; border-radius:6px; margin-bottom:14px; font-size:13px; }

      /* Sub modal (detail/review/etc) */
      .vbdh-sub-modal { position:fixed; top:0; left:0; width:100%; height:100%; z-index:1000000; display:flex; align-items:center; justify-content:center; }
      .vbdh-sub-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); }
      .vbdh-sub-container { position:relative; width:90%; max-height:80vh; background:#fff; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3); }
      .vbdh-sub-header { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid #e8e8e8; }
      .vbdh-sub-header h3 { margin:0; font-size:16px; color:#333; }
      .vbdh-modal-body { padding:20px; overflow-y:auto; flex:1; }

      .vbdh-detail-grid { display:grid; gap:8px; }
      .vbdh-detail-row { font-size:13px; padding:4px 0; border-bottom:1px solid #f0f0f0; }
      .vbdh-detail-section { margin-top:16px; font-size:14px; }
      .vbdh-detail-table { margin-top:8px; }
      .vbdh-link { color:#1a73e8; text-decoration:none; font-size:13px; }
      .vbdh-link:hover { text-decoration:underline; }

      /* Timeline */
      .vbdh-timeline { padding:4px 0; }
      .vbdh-timeline-item { padding:10px 14px; margin-bottom:8px; border-radius:6px; font-size:13px; }
      .vbdh-tl-green { background:#f6ffed; border-left:3px solid #52c41a; }
      .vbdh-tl-red { background:#fff2f0; border-left:3px solid #ff4d4f; }
      .vbdh-tl-blue { background:#f0f5ff; border-left:3px solid #1890ff; }
      .vbdh-tl-time { font-size:12px; color:#999; margin-top:2px; }
      .vbdh-tl-note { color:#666; margin-top:4px; }
    `;
  }
})();
