/**
 * Background Service Worker - VBDH Assistant
 */

// Lắng nghe extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Popup tự mở, không cần xử lý thêm
});

// Lắng nghe message từ content script hoặc popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadAttachment') {
    handleAttachmentDownload(request.url)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Tải file đính kèm và chuyển thành base64
 */
async function handleAttachmentDownload(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
