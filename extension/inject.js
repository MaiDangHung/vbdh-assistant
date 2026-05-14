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

    // Tạo modal lần đầu
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

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = getVbdhCSS();
    modal.appendChild(style);

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('.vbdh-close').onclick = () => modal.style.display = 'none';
    modal.querySelector('.vbdh-overlay').onclick = () => modal.style.display = 'none';

    // Start processing
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

    // Bind accordion
    body.querySelectorAll('.vbdh-accordion-header').forEach(header => {
      header.onclick = () => {
        const content = header.nextElementSibling;
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        header.querySelector('.vbdh-arrow').textContent = isOpen ? '▶' : '▼';
      };
    });

    // Process each doc
    for (let i = 0; i < docs.length; i++) {
      processSingleDoc(docs[i], i, modal);
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
            trichYieu: info['Trích yếu'] || '',
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

  function buildDocAccordion(doc, index) {
    const title = doc.trichYieu || doc.soKyHieu || 'Văn bản ' + (index + 1);
    const shortTitle = title.length > 80 ? title.substring(0, 80) + '...' : title;
    return `
      <div class="vbdh-accordion" data-index="${index}">
        <div class="vbdh-accordion-header">
          <span class="vbdh-arrow">▶</span>
          <div class="vbdh-accordion-title">
            <strong>${doc.soKyHieu}</strong> - ${shortTitle}
            <span class="vbdh-file-count">${doc.files.length} file(s)</span>
          </div>
          <span class="vbdh-status vbdh-status-pending" id="vbdh-status-${index}">⏳ Chờ xử lý</span>
        </div>
        <div class="vbdh-accordion-content" style="display:none" id="vbdh-content-${index}">
          <div class="vbdh-doc-info">
            <span><b>Cơ quan:</b> ${doc.coQuanBanHanh}</span>
            <span><b>Ngày:</b> ${doc.ngayBanHanh}</span>
            <span><b>Loại:</b> ${doc.loaiVanBan}</span>
            <span><b>Files:</b> ${doc.files.map(f => f.name).join(', ')}</span>
          </div>
          <div id="vbdh-result-${index}" class="vbdh-result-loading">
            <div class="vbdh-spinner"></div>
            <p>Đang xử lý...</p>
          </div>
        </div>
      </div>
    `;
  }

  // ===== PROCESS SINGLE DOC =====

  async function processSingleDoc(doc, index, modal) {
    const statusEl = document.getElementById(`vbdh-status-${index}`);
    const resultEl = document.getElementById(`vbdh-result-${index}`);
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
      // Check cache trước — tránh upload lại nếu đã xử lý
      const cacheKey = generateCacheKey(doc);
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
      } catch (e) { /* ignore cache check errors */ }

      if (cachedResult) {
        // Đã có trong cache → hiển thị kết quả luôn, không upload lại
        statusEl.className = 'vbdh-status vbdh-status-done';
        statusEl.textContent = '✅ Cache';
        const displayData = {
          extractionResult: cachedResult.extractionResult || {},
          status: cachedResult.status || 'completed',
          _cached: true
        };
        displayResult(displayData, statusEl, resultEl, cachedResult.documentId, apiUrl, apiKey);
        return;
      }

      // Chưa có → fetch files và upload như cũ
      const fileBlobs = [];
      for (let i = 0; i < doc.files.length; i++) {
        if (i > 0) await sleep(1000);
        statusEl.textContent = `⏳ Tải file ${i + 1}/${doc.files.length}...`;
        const blob = await fetchFile(doc.files[i].url);
        if (blob) fileBlobs.push({ name: doc.files[i].name, blob });
      }

      if (fileBlobs.length === 0) {
        statusEl.className = 'vbdh-status vbdh-status-error';
        statusEl.textContent = '❌ Lỗi tải file';
        resultEl.innerHTML = '<div class="vbdh-error">Không tải được file đính kèm.</div>';
        return;
      }

      // Upload
      statusEl.textContent = '⏳ Đang upload...';
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ ...doc, cacheKey }));
      formData.append('cacheKey', cacheKey);
      fileBlobs.forEach(f => formData.append('files', f.blob, f.name));

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

      // Display
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
    statusEl.textContent = isCached ? '✅ Cache' : '✅ Xong';

    const summary = extraction.summary || extraction.raw || '';
    const tasks = extraction.tasks || [];
    const departments = extraction.departments || [];

    let html = '';

    if (isCached) html += '<div class="vbdh-cache-badge">⚡ Dữ liệu cache</div>';

    // Reprocess button — ở trên cùng
    html += `<div class="vbdh-top-actions"><button class="vbdh-btn-reprocess" onclick="window.__vbdhReprocess['${documentId}'].action()">🔄 Xử lý lại</button></div>`;

    // Summary — 1 dòng riêng
    html += '<div class="vbdh-summary-line"><b>📝 Tóm tắt:</b> ' + (summary || 'Không có tóm tắt') + '</div>';

    // Combined table: STT | Nhiệm vụ | Phòng ban đề xuất
    const maxRows = Math.max(tasks.length, departments.length, 1);
    html += '<div class="vbdh-card"><div class="vbdh-card-title">📋 Nhiệm vụ & Phòng ban đề xuất</div><div class="vbdh-card-body">';
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
      html += '<p>Không có nhiệm vụ</p>';
    }
    html += '</div></div>';

    // Store for reprocess
    window.__vbdhReprocess = window.__vbdhReprocess || {};
    window.__vbdhReprocess[documentId] = {
      action: async () => {
        statusEl.className = 'vbdh-status vbdh-status-pending';
        statusEl.textContent = '⏳ Xử lý lại';
        resultEl.innerHTML = '<div class="vbdh-spinner"></div><p>Đang xử lý lại...</div>';
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
      }
    };

    resultEl.innerHTML = html;
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

  function generateCacheKey(doc) {
    const normalizedFiles = doc.files.map(f => f.name.replace(/(\.signed)+/gi, '')).sort().join(',');
    return [doc.maDinhDanh, doc.soKyHieu, doc.ngayBanHanh, doc.coQuanBanHanh, normalizedFiles].join('|||');
  }

  // ===== CSS =====

  function getVbdhCSS() {
    return `
      #vbdh-assistant-modal { position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .vbdh-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); }
      .vbdh-container { position:relative; width:90%; max-width:900px; max-height:85vh; background:#fff; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3); }
      .vbdh-header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:2px solid #1a73e8; }
      .vbdh-header h2 { margin:0; font-size:18px; color:#1a73e8; }
      .vbdh-close { background:none; border:none; font-size:28px; cursor:pointer; color:#666; padding:0 8px; }
      .vbdh-close:hover { color:#333; background:#f0f0f0; border-radius:4px; }
      .vbdh-body { padding:16px 24px; overflow-y:auto; flex:1; }
      .vbdh-loading,.vbdh-empty { text-align:center; padding:40px; color:#666; }
      .vbdh-spinner { width:36px; height:36px; border:4px solid #e8e8e8; border-top-color:#1a73e8; border-radius:50%; animation:vbdh-spin 1s linear infinite; margin:0 auto 12px; }
      @keyframes vbdh-spin { to { transform:rotate(360deg); } }
      .vbdh-accordion { border:1px solid #e0e0e0; border-radius:8px; margin-bottom:8px; overflow:hidden; }
      .vbdh-accordion-header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:#f8f9fa; cursor:pointer; user-select:none; }
      .vbdh-accordion-header:hover { background:#f0f2f5; }
      .vbdh-arrow { font-size:12px; color:#666; width:16px; }
      .vbdh-accordion-title { flex:1; font-size:14px; }
      .vbdh-file-count { font-size:12px; background:#e3f2fd; color:#1565c0; padding:2px 8px; border-radius:12px; margin-left:8px; }
      .vbdh-status { font-size:12px; padding:4px 12px; border-radius:12px; white-space:nowrap; }
      .vbdh-status-pending { background:#fff3e0; color:#e65100; }
      .vbdh-status-done { background:#e8f5e9; color:#2e7d32; }
      .vbdh-status-error { background:#ffebee; color:#c62828; }
      .vbdh-accordion-content { padding:16px; border-top:1px solid #e0e0e0; }
      .vbdh-doc-info { display:flex; flex-wrap:wrap; gap:8px 24px; font-size:13px; color:#555; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid #f0f0f0; }
      .vbdh-card { margin-bottom:12px; }
      .vbdh-card-title { font-weight:600; font-size:14px; color:#1a73e8; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #f0f0f0; }
      .vbdh-card-body { font-size:13px; line-height:1.6; color:#333; }
      .vbdh-table { width:100%; border-collapse:collapse; margin-top:4px; }
      .vbdh-table th { background:#f5f7fa; padding:8px 12px; text-align:left; font-size:13px; color:#333; border-bottom:2px solid #e0e0e0; }
      .vbdh-table td { padding:8px 12px; border-bottom:1px solid #f0f0f0; font-size:13px; }
      .vbdh-table tr:hover td { background:#fafbfc; }
      .vbdh-score-bar { display:inline-block; width:120px; height:8px; background:#e0e0e0; border-radius:4px; margin-right:8px; vertical-align:middle; }
      .vbdh-score-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#4caf50,#1a73e8); }
      .vbdh-cache-badge { display:inline-block; background:#e8f5e9; color:#2e7d32; padding:4px 12px; border-radius:12px; font-size:12px; margin-bottom:8px; }
      .vbdh-top-actions { margin-bottom:12px; }
      .vbdh-summary-line { font-size:13px; color:#333; line-height:1.6; padding:8px 0; margin-bottom:12px; border-bottom:1px solid #f0f0f0; }
      .vbdh-dept-cell { display:flex; align-items:center; gap:6px; }
      .vbdh-score-text { font-size:12px; color:#666; min-width:32px; }
      .vbdh-btn-reprocess { padding:8px 20px; background:#1a73e8; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px; margin-top:8px; }
      .vbdh-btn-reprocess:hover { background:#1557b0; }
      .vbdh-btn-reprocess:disabled { background:#ccc; cursor:not-allowed; }
      .vbdh-error { color:#c62828; padding:12px; background:#ffebee; border-radius:6px; }
      .vbdh-result-loading { text-align:center; padding:20px; }
    `;
  }
})();
