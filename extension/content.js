/**
 * Content Script - VBDH Assistant
 * 
 * Đọc dữ liệu văn bản từ React internal state của hệ thống QLVBDH
 * 
 * Data structure (traverse child từ wrapper):
 * - child depth 2: props.data = [{label, value}, ...] (thông tin văn bản)
 * - child depth 16 (sibling): props.files = [{tenTep, url, kieuTep, ...}, ...] (file đính kèm)
 */

(function () {
  'use strict';

  const RATE_LIMIT_MS = 1000;
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
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
   */
  function extractReactData() {
    try {
      // Bước 1: Tìm wrapper đang hiển thị chi tiết (có file đính kèm)
      const wrappers = document.querySelectorAll('.MuiCollapse-wrapperInner');
      let activeWrapper = null;

      wrappers.forEach((w) => {
        if (w.offsetHeight > 0 && w.querySelector('.file')) {
          if (w.querySelector('td.bold') && w.querySelector('.file__name')) {
            activeWrapper = w;
          }
        }
      });

      // Fallback
      if (!activeWrapper) {
        wrappers.forEach((w) => {
          if (w.offsetHeight > 0 && w.querySelector('.file')) {
            activeWrapper = w;
          }
        });
      }

      if (!activeWrapper) return null;

      // Bước 2: Lấy React fiber
      const keys = Object.keys(activeWrapper);
      const reactKey = keys.find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!reactKey) return null;

      let fiber = activeWrapper[reactKey];

      // Bước 3: Traverse DOWN child tree để tìm data và files
      let dataLabelValues = null;
      let filesData = null;

      // Đi xuống child depth 2 → tìm data
      let current = fiber.child?.child?.child; // depth 2 từ wrapper
      if (current?.memoizedProps?.data) {
        const d = current.memoizedProps.data;
        if (Array.isArray(d) && d.length > 5 && d[0].label && 'value' in d[0]) {
          dataLabelValues = d;
        }
      }

      // Traverse siblings từ depth 2 trở đi → tìm files
      let sibling = current;
      let maxSearch = 50;
      while (sibling && maxSearch-- > 0) {
        const p = sibling.memoizedProps;
        if (p && Array.isArray(p.files) && p.files.length > 0 && p.files[0].tenTep && p.files[0].url) {
          filesData = p.files;
          break;
        }
        // Also check children props (React elements)
        if (p && Array.isArray(p.children)) {
          for (const child of p.children) {
            if (child && child.props && Array.isArray(child.props.files) && child.props.files.length > 0) {
              filesData = child.props.files;
              break;
            }
          }
          if (filesData) break;
        }
        sibling = sibling.sibling || sibling.child;
      }

      if (!dataLabelValues) return null;

      // Bước 4: Parse data
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
