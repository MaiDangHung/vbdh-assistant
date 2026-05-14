/**
 * Content Script - VBDH Assistant
 * 
 * Đọc dữ liệu văn bản từ React internal state của hệ thống QLVBDH
 * 
 * ARCHITECTURE:
 * - Content Script: ĐỌC data + FETCH file (cùng origin → không CORS)
 * - Popup: GỬI data lên Backend (extension context → không CORS)
 * - Content Script gửi data về Popup qua chrome.runtime.sendMessage
 */

(function () {
  'use strict';

  const RATE_LIMIT_MS = 1000;
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  const FETCH_TIMEOUT_MS = 30000;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractData') {
      const reactData = extractReactData();
      if (!reactData) {
        sendResponse({ success: false, error: 'Không tìm thấy thông tin văn bản. Vui lòng mở chi tiết 1 văn bản.' });
      } else {
        sendResponse({ success: true, data: reactData });
      }
      return false;
    }

    if (request.action === 'fetchFile') {
      fetchSingleFile(request.fileUrl)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  /**
   * Trích xuất dữ liệu từ React fiber tree
   * Tìm đúng wrapper đang hiển thị chi tiết văn bản
   */
  function extractReactData() {
    try {
      // Tìm tất cả wrapperInner đang hiển thị (height > 0) và có chứa file đính kèm
      const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
      let activeWrapper = null;

      wrappers.forEach((w) => {
        // Chỉ lấy wrapper đang hiển thị và có chứa thông tin văn bản
        if (w.offsetHeight > 0 && w.querySelector('.file')) {
          // Ưu tiên wrapper có nhiều thông tin hơn (có cả td.bold và .file)
          if (w.querySelector('td.bold') && w.querySelector('.file__name')) {
            activeWrapper = w;
          }
        }
      });

      // Fallback: tìm wrapper có .file và height > 0
      if (!activeWrapper) {
        wrappers.forEach((w) => {
          if (w.offsetHeight > 0 && w.querySelector('.file')) {
            activeWrapper = w;
          }
        });
      }

      if (!activeWrapper) return null;

      // Tìm React fiber
      const keys = Object.keys(activeWrapper);
      const reactKey = keys.find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!reactKey) return null;

      let fiber = activeWrapper[reactKey];
      let dataLabelValues = null;
      let filesData = null;

      let depth = 0;
      while (fiber && depth < 30) {
        const props = fiber.memoizedProps;
        if (props) {
          // Tìm data array (thông tin văn bản: label-value pairs)
          if (!dataLabelValues && Array.isArray(props.data)) {
            const hasLabel = props.data.every(item => item.label && 'value' in item);
            if (hasLabel && props.data.length > 5) {
              dataLabelValues = props.data;
            }
          }
          // Tìm files array (danh sách file đính kèm)
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
        maDinhDanh: fields['Mã định danh'] || '',
        files: (filesData || []).map(f => ({
          name: f.tenTep,
          url: f.url,
          mimeType: f.kieuTep || 'application/pdf',
        })),
        cacheKey: generateCacheKey({
          ...fields,
          files: filesData || [],
        }),
      };
    } catch (error) {
      console.error('[VBDH Assistant] Error extracting React data:', error);
      return null;
    }
  }

  /**
   * Fetch 1 file từ cùng origin
   */
  async function fetchSingleFile(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const blob = await response.blob();

      if (blob.size > MAX_FILE_SIZE) {
        return { success: false, error: `File quá lớn (${(blob.size / 1024 / 1024).toFixed(1)}MB > 20MB)` };
      }

      const base64 = await blobToBase64(blob);

      return {
        success: true,
        data: {
          content: base64,
          size: blob.size,
        },
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Timeout (30 giây)' };
      }
      return { success: false, error: error.message };
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function generateCacheKey(data) {
    const normalizedFiles = (data.files || [])
      .map(f => normalizeFileName(f.tenTep || ''))
      .sort()
      .join(',');

    const parts = [
      data['Mã định danh'] || '',
      data['Số, ký hiệu VB'] || '',
      data['Ngày ban hành'] || '',
      data['Cơ quan ban hành'] || '',
      normalizedFiles,
    ];
    return parts.join('|||');
  }

  function normalizeFileName(name) {
    return name.replace(/(\.signed)+/gi, '');
  }
})();
