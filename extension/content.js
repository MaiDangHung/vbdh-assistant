/**
 * Content Script - VBDH Assistant
 * 
 * Đọc dữ liệu văn bản từ React internal state của hệ thống QLVBDH
 * 
 * SECURITY:
 * - Chỉ chạy khi user click Extension icon (passive, không tự động)
 * - Không modify DOM của trang web
 * - Không gửi data đi ngoài Backend API được cấu hình
 * 
 * PERFORMANCE:
 * - Đọc React state trực tiếp (0 network request để lấy thông tin)
 * - Fetch file có rate limit (1 request/giây)
 * - Không bao giờ fetch trùng file đã xử lý
 */

(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:8080/api/v1';
  const RATE_LIMIT_MS = 1000; // 1 giây giữa mỗi request fetch file
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB giới hạn
  const FETCH_TIMEOUT_MS = 30000; // 30 giây timeout

  // Lắng nghe message từ popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractAndProcess') {
      handleExtractAndProcess()
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // async response
    }
    return false;
  });

  /**
   * Main flow: Extract → Fetch files → Send to Backend
   */
  async function handleExtractAndProcess() {
    // Bước 1: Đọc React state (0 network request)
    const reactData = extractReactData();
    if (!reactData) {
      throw new Error('Không tìm thấy thông tin văn bản. Vui lòng mở chi tiết 1 văn bản trước.');
    }

    // Bước 2: Fetch files với rate limit
    const files = await fetchFilesWithRateLimit(reactData.files);

    // Bước 3: Gửi về Backend (1 request duy nhất)
    const payload = {
      subject: reactData.trichYeu,
      soVanBan: reactData.soVanBan,
      soKyHieu: reactData.soKyHieu,
      ngayBanHanh: reactData.ngayBanHanh,
      coQuanBanHanh: reactData.coQuanBanHanh,
      loaiVanBan: reactData.loaiVanBan,
      nguoiKy: reactData.nguoiKy,
      body: reactData.trichYeo || '', // Trích yếu làm nội dung chính
      files: files,
      cacheKey: generateCacheKey(reactData),
    };

    const response = await fetchWithTimeout(`${BACKEND_URL}/email/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Lỗi server: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Trích xuất dữ liệu từ React fiber tree
   * Chỉ đọc memory, KHÔNG gửi request nào
   */
  function extractReactData() {
    try {
      // Tìm wrapper chứa thông tin chi tiết văn bản
      const wrapperInner = document.querySelector('.MuiCollapse-wrapperInner');
      if (!wrapperInner) return null;

      const keys = Object.keys(wrapperInner);
      const reactKey = keys.find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!reactKey) return null;

      let fiber = wrapperInner[reactKey];
      let dataLabelValues = null;
      let filesData = null;

      // Traverse up fiber tree (tối đa 30 levels)
      let depth = 0;
      while (fiber && depth < 30) {
        const props = fiber.memoizedProps;
        if (props) {
          // Tìm data array (depth 9-10 từ root)
          if (!dataLabelValues && Array.isArray(props.data)) {
            const hasLabel = props.data.every(item => item.label && 'value' in item);
            if (hasLabel && props.data.length > 5) {
              dataLabelValues = props.data;
            }
          }

          // Tìm files array (depth 4-6)
          if (!filesData && Array.isArray(props.files) && props.files.length > 0) {
            const firstFile = props.files[0];
            if (firstFile.tenTep && firstFile.url) {
              filesData = props.files;
            }
          }

          if (dataLabelValues && filesData) break;
        }
        fiber = fiber.return;
        depth++;
      }

      if (!dataLabelValues) return null;

      // Parse label→value pairs
      const fields = {};
      dataLabelValues.forEach(item => {
        fields[item.label] = item.value;
      });

      return {
        soVanBan: fields['Sổ văn bản'] || '',
        soKyHieu: fields['Số, ký hiệu VB'] || '',
        ngayBanHanh: fields['Ngày ban hành'] || '',
        nguoiKy: fields['Người ký'] || '',
        trichYieu: fields['Trích yếu'] || '',
        coQuanBanHanh: fields['Cơ quan ban hành'] || '',
        loaiVanBan: fields['Loại văn bản'] || '',
        files: filesData || [],
      };
    } catch (error) {
      console.error('[VBDH Assistant] Error extracting React data:', error);
      return null;
    }
  }

  /**
   * Fetch danh sách file với rate limit
   * - 1 request/giây
   * - Có timeout
   * - Bỏ qua file quá lớn
   */
  async function fetchFilesWithRateLimit(files) {
    if (!files || files.length === 0) return [];

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Rate limit: đợi giữa các request
      if (i > 0) {
        await sleep(RATE_LIMIT_MS);
      }

      try {
        console.log(`[VBDH Assistant] Fetching file ${i + 1}/${files.length}: ${file.tenTep}`);

        const response = await fetchWithTimeout(file.url, {
          method: 'GET',
          credentials: 'same-origin', // Tự gửi cookie đăng nhập
        });

        if (!response.ok) {
          console.warn(`[VBDH Assistant] Failed to fetch file: ${file.tenTep}, status: ${response.status}`);
          results.push({
            name: file.tenTep,
            mimeType: file.kieuTep || 'application/pdf',
            error: `HTTP ${response.status}`,
          });
          continue;
        }

        const blob = await response.blob();

        // Kiểm tra kích thước
        if (blob.size > MAX_FILE_SIZE) {
          console.warn(`[VBDH Assistant] File too large: ${file.tenTep} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
          results.push({
            name: file.tenTep,
            mimeType: file.kieuTep || 'application/pdf',
            error: 'File quá lớn (>20MB)',
          });
          continue;
        }

        // Chuyển blob → base64
        const base64 = await blobToBase64(blob);

        results.push({
          name: file.tenTep,
          mimeType: file.kieuTep || 'application/pdf',
          content: base64,
          size: blob.size,
        });

        console.log(`[VBDH Assistant] Fetched OK: ${file.tenTep} (${(blob.size / 1024).toFixed(1)}KB)`);

      } catch (error) {
        console.error(`[VBDH Assistant] Error fetching file ${file.tenTep}:`, error);
        results.push({
          name: file.tenTep,
          mimeType: file.kieuTep || 'application/pdf',
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Fetch với timeout
   */
  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Blob → Base64
   */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // data:application/pdf;base64,JVBERi0xLjQ...
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Tạo cache key duy nhất
   * Bỏ .signed trong tên file vì mỗi đơn vị ký số thêm 1 cái .signed
   */
  function generateCacheKey(data) {
    const normalizedFiles = (data.files || [])
      .map(f => normalizeFileName(f.tenTep || ''))
      .sort()
      .join(',');

    const parts = [
      data.soKyHieu || '',
      data.ngayBanHanh || '',
      data.coQuanBanHanh || '',
      normalizedFiles,
    ];
    return parts.join('|||');
  }

  /**
   * Normalize tên file: bỏ tất cả .signed
   * VD: "3731.UBND.DTDT.10.05.2026.signed.signed.signed.signed.pdf"
   *   → "3731.UBND.DTDT.10.05.2026.pdf"
   */
  function normalizeFileName(name) {
    // Bỏ tất cả .signed (có thể nhiều cái liên tiếp)
    return name.replace(/(\.signed)+/gi, '');
  }

  /**
   * Sleep utility
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
