/**
 * inject.js - Chạy trong MAIN world của trang QLVBDH
 * Inject modal trực tiếp vào trang — giữ nguyên luồng trích xuất văn bản cũ
 *
 * KHÔNG dùng chrome.* API ở đây!
 *
 * v2.1: Dùng JWT auth từ window.__vbdhAuth.
 */

(function () {
  'use strict';

  const DEFAULT_API_URL = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';
  const DEFAULT_API_BASE = 'https://tbklhoatien.danangsite.com.vn';

  // Entry point
  toggleVbdhModal();

  // ===== AUTH HELPER =====

  function getAuthHeaders() {
    const auth = window.__vbdhAuth;
    const headers = {
      'X-Service-Name': 'vbdh-assistant',
    };

    // JWT auth from login
    if (auth && auth.token) {
      headers['Authorization'] = 'Bearer ' + auth.token;
    }

    return headers;
  }

  function getApiUrl() {
    const config = window.__vbdhConfig || {};
    return config.apiUrl || DEFAULT_API_URL;
  }

  function getApiBase() {
    const config = window.__vbdhConfig || {};
    return config.apiBase || DEFAULT_API_BASE;
  }

  // ===== TOGGLE MODAL =====

  function toggleVbdhModal() {
    const existingModal = document.getElementById('vbdh-assistant-modal');
    if (existingModal) {
      const willShow = existingModal.style.display === 'none';
      existingModal.style.display = willShow ? 'flex' : 'none';
      document.body.style.overflow = willShow ? 'hidden' : '';
      if (willShow) {
        window.__vbdhRefresh && window.__vbdhRefresh();
      }
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'vbdh-assistant-modal';
    modal.innerHTML = `
      <div class="vbdh-overlay"></div>
      <div class="vbdh-container">
        <div class="vbdh-header">
          <h2>📋 Trợ lý văn bản điều hành</h2>
          <button class="vbdh-close" title="Đóng">&times;</button>
        </div>
        <div class="vbdh-body" id="vbdh-body">
          <div class="vbdh-loading">
            <div class="vbdh-spinner"></div>
            <p>Đang phân tích văn bản...</p>
          </div>
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

    window.__vbdhRefresh = () => processAllDocuments(modal);
    window.__vbdhRefresh();
  }

  // ===== PROCESS ALL OPEN DOCUMENTS =====

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

    // Bind doc-level accordion
    body.querySelectorAll('.vbdh-doc-header').forEach(header => {
      header.onclick = () => {
        const content = header.nextElementSibling;
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        header.querySelector('.vbdh-arrow').textContent = isOpen ? '▶' : '▼';
      };
    });

    // Bind file-level accordion
    body.querySelectorAll('.vbdh-file-header').forEach(header => {
      header.onclick = () => {
        const content = header.nextElementSibling;
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        header.querySelector('.vbdh-arrow').textContent = isOpen ? '▶' : '▼';
      };
    });

    // Process each file in each doc
    for (let i = 0; i < docs.length; i++) {
      for (let j = 0; j < docs[i].files.length; j++) {
        await processSingleFile(docs[i], docs[i].files[j], i, j);
      }
      updateDocTaskBadge(docs, i);
    }
  }

  // ===== EXTRACT ALL DOCUMENTS =====

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

  // ===== BUILD ACCORDION HTML =====

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
              <div class="vbdh-spinner"></div>
              <p>Đang xử lý...</p>
            </div>
          </div>
        </div>
      `;
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
      </div>
    `;
  }

  // ===== PROCESS SINGLE FILE =====

  async function processSingleFile(doc, file, docIndex, fileIndex) {
    const statusEl = document.getElementById(`vbdh-status-${docIndex}-${fileIndex}`);
    const resultEl = document.getElementById(`vbdh-result-${docIndex}-${fileIndex}`);
    const auth = window.__vbdhAuth;
    const apiUrl = getApiUrl();

    if (!auth || !auth.token) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Chưa đăng nhập';
      resultEl.innerHTML = '<div class="vbdh-error">Vui lòng đăng nhập qua extension.</div>';
      return;
    }

    try {
      const cacheKey = generateCacheKey(doc, file);
      statusEl.textContent = '⏳ Kiểm tra cache...';

      // Check cache
      const cacheResult = await checkCache(apiUrl, cacheKey);
      console.log('[VBDH] Cache check for', file.name, '→ found=', cacheResult.found, 'cacheKey=', cacheKey);
      if (cacheResult.found && cacheResult.documentId) {
        console.log('[VBDH] Cache hit for', file.name, 'documentId=', cacheResult.documentId, 'status=', cacheResult.status);

        if (cacheResult.status === 'completed' || cacheResult.status === 'extracted') {
          if (cacheResult.extractionResult) {
            statusEl.className = 'vbdh-status vbdh-status-done';
            statusEl.textContent = '⚡ Cache';
            displayResult(
              { extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true },
              statusEl, resultEl, cacheResult.documentId, apiUrl
            );
            return;
          }
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
          displayResult(
            { extractionResult: cacheResult.extractionResult, status: cacheResult.status, _cached: true },
            statusEl, resultEl, cacheResult.documentId, apiUrl
          );
          return;
        }
      }

      // No cache → fetch file and upload
      statusEl.textContent = '⏳ Đang tải file...';
      const blob = await fetchFile(file.url);

      if (!blob) {
        statusEl.className = 'vbdh-status vbdh-status-error';
        statusEl.textContent = '❌ Lỗi tải file';
        resultEl.innerHTML = '<div class="vbdh-error">Không tải được file đính kèm.</div>';
        return;
      }

      // Upload
      statusEl.textContent = '⏳ Đang upload...';
      const singleDoc = { ...doc, files: [{ name: file.name }] };
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ ...singleDoc, cacheKey }));
      formData.append('cacheKey', cacheKey);
      formData.append('files', blob, file.name);

      const uploadRes = await fetch(`${apiUrl}/documents/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);

      const uploadJson = await uploadRes.json();
      const results = uploadJson.data?.results || [];
      const docResult = results[0];
      if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

      const documentId = docResult.documentId;

      // Poll until done
      statusEl.className = 'vbdh-status vbdh-status-pending';
      statusEl.textContent = '⏳ AI đang xử lý...';
      const extractData = await pollUntilDone(apiUrl, documentId, statusEl);
      displayResult(extractData, statusEl, resultEl, documentId, apiUrl);

    } catch (error) {
      console.error('[VBDH] Error:', error);
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Lỗi';
      resultEl.innerHTML = `<div class="vbdh-error">${error.message}</div>`;
    }
  }

  // ===== CHECK CACHE =====

  async function checkCache(apiUrl, cacheKey) {
    try {
      const res = await fetch(`${apiUrl}/documents/check-cache`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheKey }),
      });
      if (!res.ok) return { found: false };
      const json = await res.json();
      const data = json.data;
      if (data && data.exists) {
        return {
          found: true,
          documentId: data.documentId,
          status: data.status,
          extractionResult: data.extractionResult || null,
        };
      }
    } catch (e) {
      console.warn('[VBDH] Cache check error:', e);
    }
    return { found: false };
  }

  // ===== POLL UNTIL DONE =====

  async function pollUntilDone(apiUrl, documentId, statusEl) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(3000);
      if (statusEl) statusEl.textContent = `⏳ AI xử lý (${attempt + 1}/60)...`;
      try {
        const res = await fetch(`${apiUrl}/documents/${documentId}/result`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) continue;
        const json = await res.json();
        const data = json.data;
        if ((data.status === 'completed' || data.status === 'extracted') && data.extractionResult) {
          return data;
        }
        if (data.status === 'error') {
          throw new Error('AI xử lý thất bại');
        }
        if (data.extractionResult && typeof data.extractionResult === 'object' && Object.keys(data.extractionResult).length > 0) {
          return data;
        }
      } catch (e) {
        if (e.message === 'AI xử lý thất bại') throw e;
      }
    }
    throw new Error('Quá thời gian chờ AI xử lý');
  }

  // ===== DISPLAY RESULT =====

  function displayResult(data, statusEl, resultEl, documentId, apiUrl) {
    const extraction = data.extractionResult || {};
    const isCached = data._cached === true;

    statusEl.className = 'vbdh-status vbdh-status-done';
    statusEl.textContent = isCached ? '⚡ Cache' : '✅ Xong';

    const summary = extraction.summary || extraction.raw || '';
    const tasks = extraction.tasks || [];

    console.log('[VBDH] Extraction result:', JSON.stringify(extraction, null, 2));
    console.log('[VBDH] Tasks count:', tasks.length);
    if (tasks.length > 0) {
      console.log('[VBDH] First task:', JSON.stringify(tasks[0]));
    }

    let html = '';

    html += '<div class="vbdh-summary-line">📝 <b>Tóm tắt:</b> ' + (summary || 'Không có tóm tắt') + '</div>';

    html += '<div class="vbdh-section-header">';
    html += '<span class="vbdh-section-title">📋 Nhiệm vụ & Phòng ban đề xuất</span>';
    html += `<button class="vbdh-btn-reprocess" title="Xử lý lại" id="vbdh-reprocess-${documentId}">🔄</button>`;
    html += '</div>';

    if (tasks.length > 0) {
      html += '<table class="vbdh-table"><thead><tr><th style="width:40px">STT</th><th>Nhiệm vụ</th><th style="width:200px">Phòng ban đề xuất</th></tr></thead><tbody>';
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const taskTitle = typeof t === 'string' ? t : (t.title || '');
        const taskDesc = (typeof t === 'object' && t.description) ? t.description : '';
        const dept = (typeof t === 'object' && t.department) ? t.department : '';

        let taskCell = '<b>' + escapeHtml(taskTitle) + '</b>';
        if (taskDesc && taskDesc !== taskTitle) {
          taskCell += '<div class="vbdh-task-desc">' + escapeHtml(taskDesc) + '</div>';
        }

        let deptCell = dept ? '<span class="vbdh-dept-name">' + escapeHtml(dept) + '</span>' : '<span class="vbdh-dept-empty">—</span>';

        html += `<tr><td>${i + 1}</td><td style="text-align:left">${taskCell}</td><td>${deptCell}</td></tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="vbdh-no-data">Không có nhiệm vụ</div>';
    }

    resultEl.innerHTML = html;

    // Bind reprocess
    const reprocessBtn = document.getElementById(`vbdh-reprocess-${documentId}`);
    if (reprocessBtn) {
      reprocessBtn.onclick = async () => {
        if (!confirm('Bạn có muốn xử lý lại file này không?')) return;
        reprocessBtn.disabled = true;
        statusEl.className = 'vbdh-status vbdh-status-pending';
        statusEl.textContent = '⏳ Xử lý lại';
        resultEl.innerHTML = '<div class="vbdh-spinner"></div><p>Đang xử lý lại...</p>';
        try {
          const res = await fetch(`${apiUrl}/documents/${documentId}/re-extract`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
          await res.json();
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

  // ===== DOC COUNT HELPERS =====

  function updateDocFileCounts(docs) {
    // Initial display
  }

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

  // ===== CSS =====

  function getVbdhCSS() {
    return `
      #vbdh-assistant-modal { position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .vbdh-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); }
      .vbdh-container { position:relative; width:90%; max-width:900px; max-height:85vh; background:#fff; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3); text-align:left; }
      .vbdh-header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:2px solid #1a73e8; }
      .vbdh-header h2 { margin:0; font-size:18px; color:#1a73e8; text-align:left; }
      .vbdh-close { background:none; border:none; font-size:28px; cursor:pointer; color:#666; padding:0 8px; }
      .vbdh-close:hover { color:#333; background:#f0f0f0; border-radius:4px; }
      .vbdh-body { padding:16px 24px; overflow-y:auto; flex:1; text-align:left; }
      .vbdh-loading,.vbdh-empty { text-align:center; padding:40px; color:#666; }
      .vbdh-spinner { width:36px; height:36px; border:4px solid #e8e8e8; border-top-color:#1a73e8; border-radius:50%; animation:vbdh-spin 1s linear infinite; margin:0 auto 12px; }
      @keyframes vbdh-spin { to { transform:rotate(360deg); } }

      .vbdh-doc-accordion { border:1px solid #d0d5dd; border-radius:8px; margin-bottom:12px; overflow:hidden; text-align:left; }
      .vbdh-doc-header { display:flex; align-items:center; gap:10px; padding:12px 16px; background:#f0f4f8; cursor:pointer; user-select:none; text-align:left; }
      .vbdh-doc-header:hover { background:#e4eaf0; }
      .vbdh-doc-title { flex:1; font-size:14px; text-align:left; }
      .vbdh-file-count { font-size:11px; background:#d0e3f7; color:#1565c0; padding:2px 8px; border-radius:10px; margin-left:8px; }
      .vbdh-doc-content { border-top:1px solid #d0d5dd; padding:12px 16px; text-align:left; }
      .vbdh-doc-info { display:flex; flex-wrap:wrap; gap:6px 24px; font-size:13px; color:#555; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #eee; text-align:left; }
      .vbdh-doc-info div { text-align:left; }

      .vbdh-file-item { border:1px solid #e2e6ea; border-radius:6px; margin-bottom:8px; overflow:hidden; text-align:left; }
      .vbdh-file-header { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#fafbfc; cursor:pointer; user-select:none; text-align:left; }
      .vbdh-file-header:hover { background:#f0f2f5; }
      .vbdh-file-icon { font-size:16px; }
      .vbdh-file-name { flex:1; font-size:13px; color:#333; text-align:left; }
      .vbdh-file-content { border-top:1px solid #e2e6ea; padding:14px 16px; text-align:left; }

      .vbdh-status { font-size:11px; padding:3px 10px; border-radius:10px; white-space:nowrap; }
      .vbdh-status-pending { background:#fff3e0; color:#e65100; }
      .vbdh-status-done { background:#e8f5e9; color:#2e7d32; }
      .vbdh-status-error { background:#ffebee; color:#c62828; }

      .vbdh-summary-line { font-size:13px; color:#333; line-height:1.6; padding:8px 0 10px 0; margin-bottom:10px; border-bottom:1px solid #eee; text-align:left; }

      .vbdh-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .vbdh-section-title { font-weight:600; font-size:14px; color:#1a73e8; text-align:left; }
      .vbdh-btn-reprocess { width:32px; height:32px; border:1px solid #d0d5dd; background:#fff; border-radius:6px; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
      .vbdh-btn-reprocess:hover { background:#fff3e0; border-color:#e65100; }
      .vbdh-btn-reprocess:disabled { opacity:0.5; cursor:not-allowed; }

      .vbdh-table { width:100%; border-collapse:collapse; font-size:13px; text-align:left; }
      .vbdh-table th { background:#f0f4f8; padding:10px 12px; text-align:left; font-weight:600; color:#333; border:1px solid #d0d5dd; }
      .vbdh-table td { padding:10px 12px; border:1px solid #d0d5dd; vertical-align:top; text-align:left; }
      .vbdh-table tbody tr:hover td { background:#f7f9fc; }
      .vbdh-table tbody tr:nth-child(even) td { background:#fafbfc; }
      .vbdh-table tbody tr:nth-child(even):hover td { background:#f0f2f5; }

      .vbdh-dept-cell { display:flex; align-items:center; gap:6px; flex-wrap:wrap; text-align:left; }
      .vbdh-score-bar { display:inline-block; width:100px; height:8px; background:#e8e8e8; border-radius:4px; overflow:hidden; }
      .vbdh-score-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#4caf50,#1a73e8); }
      .vbdh-score-text { font-size:11px; color:#666; min-width:30px; }
      .vbdh-dept-name { font-size:13px; color:#1565c0; font-weight:500; }
      .vbdh-dept-empty { color:#bbb; }
      .vbdh-task-desc { font-size:12px; color:#666; margin-top:4px; line-height:1.5; border-top:1px dashed #e0e0e0; padding-top:4px; }

      .vbdh-no-data { font-size:13px; color:#999; padding:8px 0; text-align:left; }
      .vbdh-error { color:#c62828; padding:12px; background:#ffebee; border-radius:6px; text-align:left; font-size:13px; }
      .vbdh-result-loading { text-align:center; padding:20px; }
      .vbdh-arrow { font-size:11px; color:#888; width:14px; text-align:center; }

      .vbdh-cache-badge { display:inline-block; background:#e8f5e9; color:#2e7d32; padding:3px 10px; border-radius:10px; font-size:11px; margin-bottom:6px; }
    `;
  }
})();
