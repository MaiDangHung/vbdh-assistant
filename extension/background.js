/**
 * Background Service Worker
 * Inject modal vào trang QLVBDH khi user click extension icon
 */

// Read inject script and execute it
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('qlvbdh.danang.gov.vn')) {
    // Inject config first
    const config = await getConfig();
    
    // Set config in page context via DOM event bridge
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (cfg) => {
        window.__vbdhConfig = cfg;
      },
      args: [config],
    });

    // Inject the main script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['inject.js'],
    });
  }
});

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vbdh_api_url', 'vbdh_api_key'], (result) => {
      resolve({
        apiUrl: result.vbdh_api_url || '',
        apiKey: result.vbdh_api_key || '',
      });
    });
  });
}
