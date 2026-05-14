/**
 * Background Service Worker
 * Xử lý communication giữa popup và content script
 */

// Khi user click extension icon → inject modal vào trang
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('qlvbdh.danang.gov.vn')) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: toggleVbdhModal,
    });
  }
});

// Hàm inject vào trang - toggle modal
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
    const doc = docs[i];
    html += buildDocAccordion(doc, i);
  }
  body.innerHTML = html;

  // Bind accordion clicks
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

function extractAllDocuments() {
  const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
  const docs = [];

  wrappers.forEach((w) => {
    if (w.offsetHeight > 0 && w.querySelector('.file') && w.querySelector('td.bold') && w.querySelector('.file__name')) {
      // Parse DOM info
      const info = {};
      w.querySelectorAll('tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, idx) => {
          if (cell.classList.contains('bold') && idx + 1 < cells.length) {
            info[cell.textContent.trim()] = cells[idx + 1].textContent.trim();
          }
        });
      });

      // Get files from React fiber
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
    else { let p = sibling.return; while (p && !p.sibling) p = p.return; sibling = p?.sibling; }
  }
  return filesData;
}

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

async function processSingleDoc(doc, index, modal) {
  const statusEl = document.getElementById(`vbdh-status-${index}`);
  const resultEl = document.getElementById(`vbdh-result-${index}`);

  try {
    // Fetch all files
    const fileBlobs = [];
    for (let i = 0; i < doc.files.length; i++) {
      const file = doc.files[i];
      if (i > 0) await sleep(1000);
      const blob = await fetchFile(file.url);
      if (blob) fileBlobs.push({ name: file.name, blob });
    }

    if (fileBlobs.length === 0) {
      statusEl.className = 'vbdh-status vbdh-status-error';
      statusEl.textContent = '❌ Lỗi tải file';
      resultEl.innerHTML = '<div class="vbdh-error">Không tải được file đính kèm.</div>';
      return;
    }

    // Check cache / upload
    statusEl.textContent = '⏳ Đang upload...';

    const cacheKey = generateCacheKey(doc);
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({ ...doc, cacheKey }));
    fileBlobs.forEach(f => formData.append('files', f.blob, f.name));

    const config = await getConfig();
    const uploadRes = await fetch(`${config.apiUrl}/documents/upload`, {
      method: 'POST',
      headers: { 'X-API-Key': config.apiKey, 'X-Service-Name': 'vbdh-assistant' },
      body: formData,
    });

    if (!uploadRes.ok) throw new Error('Upload lỗi: HTTP ' + uploadRes.status);

    const uploadJson = await uploadRes.json();
    const results = uploadJson.data?.results || [];
    const docResult = results[0];
    if (!docResult?.documentId) throw new Error(docResult?.error || 'Upload thất bại');

    // Extract
    statusEl.textContent = '⏳ Đang trích xuất AI...';
    const extractRes = await fetch(`${config.apiUrl}/documents/${docResult.documentId}/extract`, {
      method: 'POST',
      headers: { 'X-API-Key': config.apiKey, 'X-Service-Name': 'vbdh-assistant' },
    });
    let extractData = (await extractRes.json()).data;

    // Poll if processing
    if (extractData.status === 'processing' || extractData.status === 'extracting') {
      for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(3000);
        statusEl.textContent = `⏳ AI xử lý (${attempt + 1}/30)...`;
        const pollRes = await fetch(`${config.apiUrl}/documents/${docResult.documentId}/result`, {
          headers: { 'X-API-Key': config.apiKey, 'X-Service-Name': 'vbdh-assistant' },
        });
        extractData = (await pollRes.json()).data;
        if (extractData.status === 'completed' || extractData.extractionResult) break;
        if (extractData.status === 'error') throw new Error('AI xử lý thất bại');
      }
    }

    // Display result
    displayResult(extractData, statusEl, resultEl, docResult.documentId, config);

  } catch (error) {
    console.error('[VBDH] Error processing doc', index, error);
    statusEl.className = 'vbdh-status vbdh-status-error';
    statusEl.textContent = '❌ Lỗi';
    resultEl.innerHTML = `<div class="vbdh-error">${error.message}</div>`;
  }
}

function displayResult(data, statusEl, resultEl, documentId, config) {
  const extraction = data.extractionResult || {};
  const isCached = data._cached === true;

  statusEl.className = 'vbdh-status vbdh-status-done';
  statusEl.textContent = isCached ? '✅ Cache' : '✅ Xong';

  const summary = extraction.summary || extraction.raw || '';
  const tasks = extraction.tasks || [];
  const departments = extraction.departments || [];

  let html = '';

  if (isCached) html += '<div class="vbdh-cache-badge">⚡ Dữ liệu cache</div>';

  // Summary
  html += '<div class="vbdh-card"><div class="vbdh-card-title">📝 Tóm tắt nội dung</div><div class="vbdh-card-body">' + (summary || 'Không có tóm tắt') + '</div></div>';

  // Tasks table
  html += '<div class="vbdh-card"><div class="vbdh-card-title">✅ Nhiệm vụ (' + tasks.length + ')</div><div class="vbdh-card-body">';
  if (tasks.length > 0) {
    html += '<table class="vbdh-table"><thead><tr><th>STT</th><th>Nhiệm vụ</th></tr></thead><tbody>';
    tasks.forEach((t, i) => {
      const text = typeof t === 'string' ? t : t.title || JSON.stringify(t);
      html += `<tr><td>${i + 1}</td><td>${text}</td></tr>`;
    });
    html += '</tbody></table>';
  } else {
    html += '<p>Không có nhiệm vụ</p>';
  }
  html += '</div></div>';

  // Departments table
  html += '<div class="vbdh-card"><div class="vbdh-card-title">🏢 Phòng ban đề xuất</div><div class="vbdh-card-body">';
  if (departments.length > 0) {
    html += '<table class="vbdh-table"><thead><tr><th>Phòng ban</th><th>Mức độ phù hợp</th></tr></thead><tbody>';
    departments.forEach(d => {
      const name = typeof d === 'string' ? d : d.name || '';
      const score = d.score || '';
      html += `<tr><td>${name}</td><td><div class="vbdh-score-bar"><div class="vbdh-score-fill" style="width:${score}%"></div></div><span>${score}%</span></td></tr>`;
    });
    html += '</tbody></table>';
  } else {
    html += '<p>Không có gợi ý</p>';
  }
  html += '</div></div>';

  // Reprocess button
  html += `<button class="vbdh-btn-reprocess" onclick="reprocessDoc('${documentId}', this)">🔄 Xử lý lại</button>`;

  // Store reprocess function
  window.__vbdhReprocess = window.__vbdhReprocess || {};
  window.__vbdhReprocess[documentId] = { statusEl, resultEl, config };

  resultEl.innerHTML = html;
}

window.reprocessDoc = async function(documentId, btn) {
  const ctx = window.__vbdhReprocess[documentId];
  if (!ctx) return;

  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý lại...';
  ctx.statusEl.className = 'vbdh-status vbdh-status-pending';
  ctx.statusEl.textContent = '⏳ Xử lý lại';
  ctx.resultEl.innerHTML = '<div class="vbdh-spinner"></div><p>Đang xử lý lại...</p>';

  try {
    const res = await fetch(`${ctx.config.apiUrl}/documents/${documentId}/re-extract`, {
      method: 'POST',
      headers: { 'X-API-Key': ctx.config.apiKey, 'X-Service-Name': 'vbdh-assistant' },
    });
    let data = (await res.json()).data;

    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      const poll = await fetch(`${ctx.config.apiUrl}/documents/${documentId}/result`, {
        headers: { 'X-API-Key': ctx.config.apiKey, 'X-Service-Name': 'vbdh-assistant' },
      });
      data = (await poll.json()).data;
      if (data.status === 'completed' || data.extractionResult) break;
      if (data.status === 'error') throw new Error('AI thất bại');
    }

    displayResult(data, ctx.statusEl, ctx.resultEl, documentId, ctx.config);
  } catch (e) {
    ctx.statusEl.className = 'vbdh-status vbdh-status-error';
    ctx.statusEl.textContent = '❌ Lỗi';
    ctx.resultEl.innerHTML = `<div class="vbdh-error">${e.message}</div>`;
  }
};

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

async function getConfig() {
  // Get config from extension storage via custom event
  return new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener('vbdh-config-response', handler);
      resolve(e.detail);
    };
    document.addEventListener('vbdh-config-response', handler);
    document.dispatchEvent(new CustomEvent('vbdh-config-request'));
    setTimeout(() => resolve(null), 2000);
  });
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
    .vbdh-loading, .vbdh-empty { text-align:center; padding:40px; color:#666; }
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
    .vbdh-score-bar { display:inline-block; width:120px; height:8px; background:#e0e0e0; border-radius:4px; margin-right:8px; }
    .vbdh-score-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#4caf50,#1a73e8); }
    .vbdh-cache-badge { display:inline-block; background:#e8f5e9; color:#2e7d32; padding:4px 12px; border-radius:12px; font-size:12px; margin-bottom:8px; }
    .vbdh-btn-reprocess { padding:8px 20px; background:#1a73e8; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px; margin-top:8px; }
    .vbdh-btn-reprocess:hover { background:#1557b0; }
    .vbdh-btn-reprocess:disabled { background:#ccc; cursor:not-allowed; }
    .vbdh-error { color:#c62828; padding:12px; background:#ffebee; border-radius:6px; }
    .vbdh-result-loading { text-align:center; padding:20px; }
  `;
}
