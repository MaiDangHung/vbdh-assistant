/**
 * inject.js - Chạy trong MAIN world của trang QLVBDH
 * 
 * 2 chế độ theo role:
 * - ADMIN/LEADER: Tab Trích xuất (accordion cũ) + Tab Nhiệm vụ (tạo/giao)
 * - DEPT_HEAD/STAFF: Chỉ Tab Nhiệm vụ (danh sách + actions)
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
  const isAdminOrLeader = role === 'ADMIN' || role === 'LEADER';
  const isDeptHead = role === 'DEPT_HEAD';
  const isStaff = role === 'STAFF';

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
      tabsHtml = `
        <div class="vbdh-tabs">
          <button class="vbdh-tab active" data-tab="extract" id="vbdh-tab-extract">📄 Trích xuất</button>
          <button class="vbdh-tab" data-tab="tasks" id="vbdh-tab-tasks">📋 Nhiệm vụ</button>
        </div>`;
    }

    modal.innerHTML = `
      <div class="vbdh-overlay"></div>
      <div class="vbdh-container">
        <div class="vbdh-header">
          <h2>📋 Trợ lý văn bản điều hành <span class="vbdh-role-badge vbdh-role-${role.toLowerCase()}">${getRoleLabel(role)}</span></h2>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="vbdh-btn vbdh-btn-sm" id="vbdh-btn-refresh" title="Làm mới trích xuất" style="display:none;font-size:12px">🔄 Làm mới</button>
            <button class="vbdh-close" title="Đóng">&times;</button>
          </div>
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

    // Bind refresh button
    const refreshBtn = modal.querySelector('#vbdh-btn-refresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        window.__vbdhRefresh && window.__vbdhRefresh();
      };
    }

    // Show default view
    if (isAdminOrLeader) {
      window.__vbdhRefresh = () => processAllDocuments(modal);
      window.__vbdhRefresh();
    } else {
      switchTab('tasks');
    }
  }

  function getRoleLabel(r) {
    const labels = { LEADER: 'Lãnh đạo', ADMIN: 'Chánh VP', DEPT_HEAD: 'Trưởng phòng', STAFF: 'Chuyên viên' };
    return labels[r] || r;
  }

  function switchTab(tabName) {
    const body = document.getElementById('vbdh-body');
    if (!body) return;
    const refreshBtn = document.getElementById('vbdh-btn-refresh');

    // Update tab buttons
    document.querySelectorAll('.vbdh-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    if (tabName === 'extract') {
      // Show refresh button, only auto-process if not already done
      if (refreshBtn) refreshBtn.style.display = 'inline-block';
      if (!body.querySelector('.vbdh-doc-header')) {
        window.__vbdhRefresh && window.__vbdhRefresh();
      }
    } else if (tabName === 'tasks') {
      // Hide refresh button on tasks tab
      if (refreshBtn) refreshBtn.style.display = 'none';
      loadTasksPanel(body);
    }
  }

  // ===================================================================
  // TASK MANAGEMENT PANEL
  // ===================================================================

  async function apiGet(path) {
    const res = await fetch(getApiBase() + path, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(getApiBase() + path, {
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
    const res = await fetch(getApiBase() + path, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiDelete(path) {
    const res = await fetch(getApiBase() + path, {
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
        apiGet('/api/v1/admin/users').catch(() => ({ data: { data: [] } })),
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
        { key: 'assigned', label: '📥 Chờ phân công' },
        { key: 'in_progress', label: '🔄 Đang thực hiện' },
        { key: 'pending_review', label: '⏳ Chờ duyệt' },
        { key: 'dept_rejected', label: '⚠️ Bị trả lại' },
        { key: 'completed', label: '✅ Hoàn thành' },
      ];
    }
    if (isDeptHead) {
      return [
        { key: '', label: '📋 Tất cả' },
        { key: 'assigned', label: '📥 Chờ phân công' },
        { key: 'dept_assigned', label: '👥 Đã phân công' },
        { key: 'pending_review', label: '⏳ Chờ CVP duyệt' },
        { key: 'dept_rejected', label: '⚠️ Bị trả lại' },
        { key: 'completed', label: '✅ Hoàn thành' },
      ];
    }
    // STAFF
    return [
      { key: '', label: '📋 Tất cả' },
      { key: 'dept_assigned', label: '📥 Đã nhận' },
      { key: 'in_progress', label: '🔄 Đang làm' },
      { key: 'pending_review', label: '⏳ Chờ CVP duyệt' },
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
      const sl = { assigned: 'Chờ phân công', dept_assigned: 'Đã phân công', in_progress: 'Đang làm', pending_review: 'Chờ duyệt', dept_rejected: 'Bị trả lại', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
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

    // Phân công NV — DEPT_HEAD, status = assigned
    if (isDeptHead && sv === 'assigned') {
      btns += `<button class="vbdh-btn vbdh-btn-sm vbdh-btn-primary" data-action="assign" data-id="${t.id}" data-dept="${t.assignedDepartmentId || ''}">👤 Phân công</button>`;
    }

    // Duyệt (CVP) — ADMIN, status = pending_review
    if (role === 'ADMIN' && sv === 'pending_review') {
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#722ed1;color:#fff" data-action="review" data-id="${t.id}">✅ Duyệt</button>`;
    }

    // Tiến độ — STAFF/DEPT_HEAD, status in progress
    if ((isStaff || isDeptHead) && ['dept_assigned', 'in_progress', 'dept_rejected'].includes(sv)) {
      btns += `<button class="vbdh-btn vbdh-btn-sm" data-action="progress" data-id="${t.id}" data-pct="${t.progress || 0}">📊 Tiến độ</button>`;
    }

    // Gửi duyệt — STAFF/DEPT_HEAD, progress = 100
    if ((isStaff || isDeptHead) && ['dept_assigned', 'in_progress', 'dept_rejected'].includes(sv)) {
      const canSubmit = (t.progress || 0) >= 100;
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#fa8c16;color:#fff" data-action="submit" data-id="${t.id}" ${canSubmit ? '' : 'disabled title="Tiến độ phải đạt 100%"'}>📤 Gửi duyệt</button>`;
    }

    // Hoàn thành — ADMIN (trực tiếp)
    if (role === 'ADMIN' && !['completed', 'cancelled', 'pending_review'].includes(sv)) {
      btns += `<button class="vbdh-btn vbdh-btn-sm" style="background:#52c41a;color:#fff" data-action="complete" data-id="${t.id}">✔️ Hoàn thành</button>`;
    }

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

    // Xóa — ADMIN
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
      case 'complete':
        if (!confirm('Hoàn thành nhiệm vụ này?')) return;
        try {
          await apiPut(`/api/v1/tasks/${id}/complete`);
          alert('✅ Đã hoàn thành');
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
        window.open(getApiBase() + `/api/v1/documents/${btn.dataset.docId}/download`, '_blank');
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
        priority: document.getElementById('vbdh-ct-priority').value,
        dueDate: document.getElementById('vbdh-ct-deadline').value || null,
        departmentId: dept,
      };

      try {
        await apiPost('/api/v1/tasks', payload);
        overlay.remove();
        loadTasks(body);
      } catch (e) { alert('❌ ' + e.message); }
    };
  }

  // ===== ASSIGN TO STAFF MODAL =====

  function openAssignModal(taskId, deptId) {
    const staffInDept = taskState.users.filter(u =>
      u.department?.id === deptId && u.role?.name === 'STAFF' && u.isActive !== false
    );

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
        await apiPost(`/api/v1/tasks/${taskId}/progress`, {
          percent: parseInt(slider.value),
          note: document.getElementById('vbdh-pg-note').value,
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
        html += `<div class="vbdh-detail-section"><a href="${getApiBase()}/api/v1/documents/${t.documentId}/download" target="_blank" class="vbdh-link">📎 Tải file gốc</a></div>`;
      }

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

  async function processAllDocuments(modal) {
    const body = modal.querySelector('#vbdh-body');
    body.innerHTML = '<div class="vbdh-loading"><div class="vbdh-spinner"></div><p>Đang phân tích văn bản...</p></div>';

    const docs = extractAllDocuments();
    console.log('[VBDH] Found', docs.length, 'open documents');

    if (docs.length === 0) {
      body.innerHTML = '<div class="vbdh-empty">📭 Không tìm thấy văn bản nào đang mở chi tiết.</div>';
      return;
    }

    let html = '';
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
      for (let j = 0; j < docs[i].files.length; j++) {
        await processSingleFile(docs[i], docs[i].files[j], i, j);
      }
      updateDocTaskBadge(docs, i);
    }
  }

  function extractAllDocuments() {
    const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
    const docs = [];
    wrappers.forEach((w) => {
      if (w.offsetHeight > 0 && w.querySelector('.file') && w.querySelector('td.bold') && w.querySelector('.file__name')) {
        const info = {};
        w.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          cells.forEach((cell, idx) => {
            if (cell.classList.contains('bold') && idx + 1 < cells.length) {
              info[cell.textContent.trim()] = cells[idx + 1].textContent.trim();
            }
          });
        });
        const files = extractFilesFromWrapper(w);
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
        }
      }
    });
    return docs;
  }

  function extractFilesFromWrapper(wrapper) {
    let filesData = [];
    const rk = Object.keys(wrapper).find(k => k.startsWith('__reactFiber$'));
    if (!rk) return [];
    let fiber = wrapper[rk];
    let current = fiber.child?.child?.child;
    if (!current) return [];
    let sibling = current;
    let maxSearch = 100;
    while (sibling && maxSearch-- > 0) {
      const p = sibling.memoizedProps;
      if (p && Array.isArray(p.files) && p.files.length > 0 && p.files[0].tenTep) {
        filesData = p.files.map(f => ({ name: f.tenTep, url: f.url, mimeType: f.kieuTep || 'application/pdf' }));
        break;
      }
      if (sibling.sibling) sibling = sibling.sibling;
      else if (sibling.child) sibling = sibling.child;
      else { let pr = sibling.return; while (pr && !pr.sibling) pr = pr.return; sibling = pr?.sibling; }
    }
    return filesData;
  }

  function buildDocAccordion(doc, docIndex) {
    const title = doc.trichYeu || doc.soKyHieu || 'Văn bản ' + (docIndex + 1);
    const shortTitle = title.length > 80 ? title.substring(0, 80) + '...' : title;
    let filesHtml = '';
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
    return `
      <div class="vbdh-doc-accordion" data-doc="${docIndex}">
        <div class="vbdh-doc-header">
          <span class="vbdh-arrow">▶</span>
          <div class="vbdh-doc-title">
            <strong>${doc.soKyHieu}</strong> — ${shortTitle}
            <span class="vbdh-file-count" id="vbdh-file-count-${docIndex}">${doc.files.length} file(s)</span>
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
        if ((cacheResult.status === 'completed' || cacheResult.status === 'extracted') && cacheResult.extractionResult) {
          statusEl.className = 'vbdh-status vbdh-status-done';
          statusEl.textContent = '⚡ Cache';
          displayResult({ extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true }, statusEl, resultEl, cacheResult.documentId, apiUrl);
          return;
        }
        if (cacheResult.status === 'processing' || cacheResult.status === 'extracting') {
          statusEl.className = 'vbdh-status vbdh-status-pending';
          statusEl.textContent = '⏳ AI đang xử lý...';
          const extractData = await pollUntilDone(apiUrl, cacheResult.documentId, statusEl);
          displayResult(extractData, statusEl, resultEl, cacheResult.documentId, apiUrl);
          return;
        }
        if (cacheResult.extractionResult) {
          statusEl.className = 'vbdh-status vbdh-status-done';
          statusEl.textContent = '⚡ Cache';
          displayResult({ extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true }, statusEl, resultEl, cacheResult.documentId, apiUrl);
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

      const uploadRes = await fetch(`${apiUrl}/documents/upload`, { method: 'POST', headers: getAuthHeaders(), body: formData });
      if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);
      const uploadJson = await uploadRes.json();
      const results = uploadJson.data?.results || [];
      const docResult = results[0];
      if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

      const documentId = docResult.documentId;
      statusEl.className = 'vbdh-status vbdh-status-pending';
      statusEl.textContent = '⏳ AI đang xử lý...';
      const extractData = await pollUntilDone(apiUrl, documentId, statusEl);
      displayResult(extractData, statusEl, resultEl, documentId, apiUrl);
    } catch (error) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Lỗi';
      resultEl.innerHTML = `<div class="vbdh-error">${error.message}</div>`;
    }
  }

  async function checkCache(apiUrl, cacheKey) {
    try {
      const res = await fetch(`${apiUrl}/documents/check-cache`, {
        method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ cacheKey }),
      });
      if (!res.ok) return { found: false };
      const json = await res.json();
      const data = json.data;
      if (data && data.exists) return { found: true, documentId: data.documentId, status: data.status, extractionResult: data.extractionResult || null };
    } catch (e) { console.warn('[VBDH] Cache check error:', e); }
    return { found: false };
  }

  async function pollUntilDone(apiUrl, documentId, statusEl) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(3000);
      if (statusEl) statusEl.textContent = `⏳ AI xử lý (${attempt + 1}/60)...`;
      try {
        const res = await fetch(`${apiUrl}/documents/${documentId}/result`, { headers: getAuthHeaders() });
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

  function displayResult(data, statusEl, resultEl, documentId, apiUrl) {
    const extraction = data.extractionResult || {};
    const isCached = data._cached === true;
    statusEl.className = 'vbdh-status vbdh-status-done';
    statusEl.textContent = isCached ? '⚡ Cache' : '✅ Xong';

    const summary = extraction.summary || extraction.raw || '';
    const tasks = extraction.tasks || [];

    let html = '';
    html += '<div class="vbdh-summary-line">📝 <b>Tóm tắt:</b> ' + (summary || 'Không có tóm tắt') + '</div>';
    html += '<div class="vbdh-section-header"><span class="vbdh-section-title">📋 Nhiệm vụ & Phòng ban đề xuất</span>';
    html += `<button class="vbdh-btn-reprocess" title="Xử lý lại" id="vbdh-reprocess-${documentId}">🔄</button></div>`;

    if (tasks.length > 0) {
      html += '<table class="vbdh-table"><thead><tr><th style="width:40px">STT</th><th>Nhiệm vụ</th><th style="width:200px">Phòng ban đề xuất</th></tr></thead><tbody>';
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const taskTitle = typeof t === 'string' ? t : (t.title || '');
        const taskDesc = (typeof t === 'object' && t.description) ? t.description : '';
        const dept = (typeof t === 'object' && t.department) ? t.department : '';
        let taskCell = '<b>' + escapeHtml(taskTitle) + '</b>';
        if (taskDesc && taskDesc !== taskTitle) taskCell += '<div class="vbdh-task-desc">' + escapeHtml(taskDesc) + '</div>';
        let deptCell = dept ? '<span class="vbdh-dept-name">' + escapeHtml(dept) + '</span>' : '<span class="vbdh-dept-empty">—</span>';
        html += `<tr><td>${i + 1}</td><td style="text-align:left">${taskCell}</td><td>${deptCell}</td></tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="vbdh-no-data">Không có nhiệm vụ</div>';
    }

    resultEl.innerHTML = html;

    const reprocessBtn = document.getElementById(`vbdh-reprocess-${documentId}`);
    if (reprocessBtn) {
      reprocessBtn.onclick = async () => {
        if (!confirm('Xử lý lại file này?')) return;
        reprocessBtn.disabled = true;
        statusEl.className = 'vbdh-status vbdh-status-pending';
        statusEl.textContent = '⏳ Xử lý lại';
        resultEl.innerHTML = '<div class="vbdh-spinner"></div><p>Đang xử lý lại...</p>';
        try {
          await fetch(`${apiUrl}/documents/${documentId}/re-extract`, { method: 'POST', headers: getAuthHeaders() });
          const d = await pollUntilDone(apiUrl, documentId, statusEl);
          displayResult(d, statusEl, resultEl, documentId, apiUrl);
        } catch (e) {
          statusEl.className = 'vbdh-status vbdh-status-error';
          statusEl.textContent = '❌ Lỗi';
          resultEl.innerHTML = `<div class="vbdh-error">${e.message}</div>`;
        }
      };
    }
  }

  function updateDocFileCounts(docs) {}
  function updateDocTaskBadge(docs, docIndex) {
    const badge = document.getElementById(`vbdh-file-count-${docIndex}`);
    if (!badge) return;
    const docContent = document.getElementById(`vbdh-doc-content-${docIndex}`);
    const taskRows = docContent ? docContent.querySelectorAll('.vbdh-table tbody tr').length : 0;
    badge.textContent = `${docs[docIndex].files.length} file · ${taskRows} nhiệm vụ`;
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
    return [doc.maDinhDanh, normalizedFileName].join('|||');
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
