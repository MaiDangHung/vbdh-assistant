/**
 * inject.js - Chạy trong MAIN world của trang QLVBDH
 * Inject modal trực tiếp vào trang
 * 
 * KHÔNG dùng chrome.* API ở đây!
 */

(function () {
  'use strict';

  const DEFAULT_API_URL = 'https://tbklhoatien.danangsite.com.vn/api/v1/ext';

  // Entry point
  toggleVbdhModal();

  // ===== TOGGLE MODAL =====

  function toggleVbdhModal() {
    const existingModal = document.getElementById('vbdh-assistant-modal');
    if (existingModal) {
      existingModal.style.display = existingModal.style.display === 'none' ? 'flex' : 'none';
      if (existingModal.style.display === 'flex') {
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

    modal.querySelector('.vbdh-close').onclick = () => modal.style.display = 'none';
    modal.querySelector('.vbdh-overlay').onclick = () => modal.style.display = 'none';

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

    // Build HTML: mỗi văn bản là 1 accordion, bên trong có sub-accordion cho từng file
    let html = '';
    for (let i = 0; i < docs.length; i++) {
      html += buildDocAccordion(docs[i], i);
    }
    body.innerHTML = html;

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
        processSingleFile(docs[i], docs[i].files[j], i, j);
      }
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
            <span class="vbdh-file-count">${doc.files.length} file(s)</span>
          </div>
        </div>
        <div class="vbdh-doc-content" style="display:none">
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
    const config = window.__vbdhConfig || {};
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    const apiKey = config.apiKey || '';

    if (!apiKey) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Chưa cấu hình API Key';
      resultEl.innerHTML = '<div class="vbdh-error">Vui lòng cấu hình API Key trong extension.</div>';
      return;
    }

    try {
      // Cache key cho từng file riêng biệt
      const cacheKey = generateCacheKey(doc, file);
      statusEl.textContent = '⏳ Kiểm tra cache...';

      let cachedResult = null;
      try {
        const cacheRes = await fetch(`${apiUrl}/documents/check-cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
          body: JSON.stringify({ cacheKey }),
        });
        if (cacheRes.ok) {
          const cacheJson = await cacheRes.json();
          if (cacheJson.data && cacheJson.data.exists) {
            cachedResult = cacheJson.data;
          }
        }
      } catch (e) { /* ignore */ }

      if (cachedResult) {
        statusEl.className = 'vbdh-status vbdh-status-done';
        statusEl.textContent = '⚡ Cache';
        const displayData = {
          extractionResult: cachedResult.extractionResult || {},
          status: cachedResult.status || 'completed',
          _cached: true
        };
        displayResult(displayData, statusEl, resultEl, cachedResult.documentId, apiUrl, apiKey);
        return;
      }

      // Fetch file
      statusEl.textContent = '⏳ Đang tải file...';
      const blob = await fetchFile(file.url);

      if (!blob) {
        statusEl.className = 'vbdh-status vbdh-status-error';
        statusEl.textContent = '❌ Lỗi tải file';
        resultEl.innerHTML = '<div class="vbdh-error">Không tải được file đính kèm.</div>';
        return;
      }

      // Upload 1 file duy nhất
      statusEl.textContent = '⏳ Đang upload...';
      const singleDoc = { ...doc, files: [file] };
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ ...singleDoc, cacheKey }));
      formData.append('cacheKey', cacheKey);
      formData.append('files', blob, file.name);

      const uploadRes = await fetch(`${apiUrl}/documents/upload`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);

      const uploadJson = await uploadRes.json();
      const results = uploadJson.data?.results || [];
      const docResult = results[0];
      if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

      // Extract
      statusEl.textContent = '⏳ Đang trích xuất AI...';
      const extractRes = await fetch(`${apiUrl}/documents/${docResult.documentId}/extract`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
      });
      let extractData = (await extractRes.json()).data;

      // Poll if processing
      if (extractData.status === 'processing' || extractData.status === 'extracting') {
        for (let attempt = 0; attempt < 30; attempt++) {
          await sleep(3000);
          statusEl.textContent = `⏳ AI xử lý (${attempt + 1}/30)...`;
          const pollRes = await fetch(`${apiUrl}/documents/${docResult.documentId}/result`, {
            headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
          });
          extractData = (await pollRes.json()).data;
          if (extractData.status === 'completed' || extractData.extractionResult) break;
          if (extractData.status === 'error') throw new Error('AI xử lý thất bại');
        }
      }

      displayResult(extractData, statusEl, resultEl, docResult.documentId, apiUrl, apiKey);

    } catch (error) {
      console.error('[VBDH] Error:', error);
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Lỗi';
      resultEl.innerHTML = `<div class="vbdh-error">${error.message}</div>`;
    }
  }

  // ===== DISPLAY RESULT =====

  function displayResult(data, statusEl, resultEl, documentId, apiUrl, apiKey) {
    const extraction = data.extractionResult || {};
    const isCached = data._cached === true;

    statusEl.className = 'vbdh-status vbdh-status-done';
    statusEl.textContent = isCached ? '⚡ Cache' : '✅ Xong';

    const summary = extraction.summary || extraction.raw || '';
    const tasks = extraction.tasks || [];
    const departments = extraction.departments || [];

    let html = '';

    // Summary — 1 dòng
    html += '<div class="vbdh-summary-line">📝 <b>Tóm tắt:</b> ' + (summary || 'Không có tóm tắt') + '</div>';

    // Tiêu đề + nút xử lý lại cùng dòng
    html += '<div class="vbdh-section-header">';
    html += '<span class="vbdh-section-title">📋 Nhiệm vụ & Phòng ban đề xuất</span>';
    html += `<button class="vbdh-btn-reprocess" title="Xử lý lại" id="vbdh-reprocess-${documentId}">🔄</button>`;
    html += '</div>';

    // Table with border
    const maxRows = Math.max(tasks.length, departments.length, 1);
    if (tasks.length > 0 || departments.length > 0) {
      html += '<table class="vbdh-table"><thead><tr><th style="width:40px">STT</th><th>Nhiệm vụ</th><th>Phòng ban đề xuất</th></tr></thead><tbody>';
      for (let i = 0; i < maxRows; i++) {
        const task = tasks[i] ? (typeof tasks[i] === 'string' ? tasks[i] : tasks[i].title || JSON.stringify(tasks[i])) : '';
        const dept = departments[i] ? (typeof departments[i] === 'string' ? departments[i] : departments[i].name || '') : '';
        const score = departments[i] && departments[i].score ? departments[i].score : '';
        const scoreHtml = score !== '' ? `<div class="vbdh-dept-cell"><span>${dept}</span><div class="vbdh-score-bar"><div class="vbdh-score-fill" style="width:${score}%"></div></div><span class="vbdh-score-text">${score}%</span></div>` : (dept ? `<span>${dept}</span>` : '');
        html += `<tr><td>${i + 1}</td><td>${task}</td><td>${scoreHtml}</td></tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="vbdh-no-data">Không có nhiệm vụ</div>';
    }

    // Bind reprocess with confirm
    resultEl.innerHTML = html;

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
            headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
          });
          let d = (await res.json()).data;
          for (let i = 0; i < 30; i++) {
            await sleep(3000);
            const p = await fetch(`${apiUrl}/documents/${documentId}/result`, {
              headers: { 'X-API-Key': apiKey, 'X-Service-Name': 'vbdh-assistant' },
            });
            d = (await p.json()).data;
            if (d.status === 'completed' || d.extractionResult) break;
            if (d.status === 'error') throw new Error('AI thất bại');
          }
          displayResult(d, statusEl, resultEl, documentId, apiUrl, apiKey);
        } catch (e) {
          statusEl.className = 'vbdh-status vbdh-status-error';
          statusEl.textContent = '❌ Lỗi';
          resultEl.innerHTML = `<div class="vbdh-error">${e.message}</div>`;
        }
      };
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

  function generateCacheKey(doc, file) {
    const normalizedFileName = file.name.replace(/(\.signed)+/gi, '');
    return [doc.maDinhDanh, doc.soKyHieu, doc.ngayBanHanh, doc.coQuanBanHanh, normalizedFileName].join('|||');
  }

  // ===== CSS =====

  function getVbdhCSS() {
    return `
      #vbdh-assistant-modal { position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .vbdh-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); }
      .vbdh-container { position:relative; width:90%; max-width:900px; max-height:85vh; background:#fff; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3); }
      .vbdh-header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:2px solid #1a73e8; }
      .vbdh-header h2 { margin:0; font-size:18px; color:#1a73e8; text-align:left; }
      .vbdh-close { background:none; border:none; font-size:28px; cursor:pointer; color:#666; padding:0 8px; }
      .vbdh-close:hover { color:#333; background:#f0f0f0; border-radius:4px; }
      .vbdh-body { padding:16px 24px; overflow-y:auto; flex:1; }
      .vbdh-loading,.vbdh-empty { text-align:center; padding:40px; color:#666; }
      .vbdh-spinner { width:36px; height:36px; border:4px solid #e8e8e8; border-top-color:#1a73e8; border-radius:50%; animation:vbdh-spin 1s linear infinite; margin:0 auto 12px; }
      @keyframes vbdh-spin { to { transform:rotate(360deg); } }

      /* Doc accordion */
      .vbdh-doc-accordion { border:1px solid #d0d5dd; border-radius:8px; margin-bottom:12px; overflow:hidden; }
      .vbdh-doc-header { display:flex; align-items:center; gap:10px; padding:12px 16px; background:#f0f4f8; cursor:pointer; user-select:none; text-align:left; }
      .vbdh-doc-header:hover { background:#e4eaf0; }
      .vbdh-doc-title { flex:1; font-size:14px; text-align:left; }
      .vbdh-file-count { font-size:11px; background:#d0e3f7; color:#1565c0; padding:2px 8px; border-radius:10px; margin-left:8px; }
      .vbdh-doc-content { border-top:1px solid #d0d5dd; padding:12px 16px; }
      .vbdh-doc-info { display:flex; flex-wrap:wrap; gap:6px 24px; font-size:13px; color:#555; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #eee; text-align:left; }
      .vbdh-doc-info div { text-align:left; }

      /* File accordion */
      .vbdh-file-item { border:1px solid #e2e6ea; border-radius:6px; margin-bottom:8px; overflow:hidden; }
      .vbdh-file-header { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#fafbfc; cursor:pointer; user-select:none; text-align:left; }
      .vbdh-file-header:hover { background:#f0f2f5; }
      .vbdh-file-icon { font-size:16px; }
      .vbdh-file-name { flex:1; font-size:13px; color:#333; text-align:left; }
      .vbdh-file-content { border-top:1px solid #e2e6ea; padding:14px 16px; }

      /* Status badges */
      .vbdh-status { font-size:11px; padding:3px 10px; border-radius:10px; white-space:nowrap; }
      .vbdh-status-pending { background:#fff3e0; color:#e65100; }
      .vbdh-status-done { background:#e8f5e9; color:#2e7d32; }
      .vbdh-status-error { background:#ffebee; color:#c62828; }

      /* Summary */
      .vbdh-summary-line { font-size:13px; color:#333; line-height:1.6; padding:8px 0 10px 0; margin-bottom:10px; border-bottom:1px solid #eee; text-align:left; }

      /* Section header: title left + reprocess right */
      .vbdh-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .vbdh-section-title { font-weight:600; font-size:14px; color:#1a73e8; }
      .vbdh-btn-reprocess { width:32px; height:32px; border:1px solid #d0d5dd; background:#fff; border-radius:6px; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
      .vbdh-btn-reprocess:hover { background:#fff3e0; border-color:#e65100; }
      .vbdh-btn-reprocess:disabled { opacity:0.5; cursor:not-allowed; }

      /* Table with border */
      .vbdh-table { width:100%; border-collapse:collapse; font-size:13px; }
      .vbdh-table th { background:#f0f4f8; padding:10px 12px; text-align:left; font-weight:600; color:#333; border:1px solid #d0d5dd; }
      .vbdh-table td { padding:10px 12px; border:1px solid #d0d5dd; vertical-align:top; }
      .vbdh-table tbody tr:hover td { background:#f7f9fc; }
      .vbdh-table tbody tr:nth-child(even) td { background:#fafbfc; }
      .vbdh-table tbody tr:nth-child(even):hover td { background:#f0f2f5; }

      /* Score bar */
      .vbdh-dept-cell { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .vbdh-score-bar { display:inline-block; width:100px; height:8px; background:#e8e8e8; border-radius:4px; overflow:hidden; }
      .vbdh-score-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#4caf50,#1a73e8); }
      .vbdh-score-text { font-size:11px; color:#666; min-width:30px; }

      /* Misc */
      .vbdh-no-data { font-size:13px; color:#999; padding:8px 0; text-align:left; }
      .vbdh-error { color:#c62828; padding:12px; background:#ffebee; border-radius:6px; text-align:left; font-size:13px; }
      .vbdh-result-loading { text-align:center; padding:20px; }
      .vbdh-arrow { font-size:11px; color:#888; width:14px; text-align:center; }

      /* Cache badge */
      .vbdh-cache-badge { display:inline-block; background:#e8f5e9; color:#2e7d32; padding:3px 10px; border-radius:10px; font-size:11px; margin-bottom:6px; }
    `;
  }
})();
