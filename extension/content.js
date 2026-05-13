/**
 * Content Script - VBDH Assistant
 * Đọc nội dung email từ Outlook Web DOM
 */

(function () {
  'use strict';

  // Lắng nghe message từ popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEmail') {
      const emailData = extractCurrentEmail();
      sendResponse(emailData);
    }
    return true; // Giữ channel mở cho async response
  });

  /**
   * Trích xuất nội dung email hiện tại từ DOM Outlook Web
   */
  function extractCurrentEmail() {
    try {
      const result = {
        success: true,
        subject: getSubject(),
        sender: getSender(),
        sentDate: getSentDate(),
        body: getBody(),
        attachments: getAttachments(),
        emailId: getEmailId(),
      };

      // Tạo cache key
      result.cacheKey = generateCacheKey(result);

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Lấy tiêu đề email
   */
  function getSubject() {
    // Outlook Web - selector cho subject
    const selectors = [
      '#ReadingPaneContainerId [role="heading"]',
      '[role="heading"][aria-level="1"]',
      'div[class*="subject"] [role="heading"]',
      'span[class*="SubjectText"]',
      'h1[class*="subject"]',
      '#SubjectTextBox',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  /**
   * Lấy người gửi
   */
  function getSender() {
    const selectors = [
      '#ReadingPaneContainerId [role="heading"][aria-level="2"]',
      'span[class*="Sender"]',
      'div[class*="sender"] span',
      '[aria-label*="Người gửi"]',
      '[aria-label*="From"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  /**
   * Lấy ngày gửi
   */
  function getSentDate() {
    const selectors = [
      'span[class*="_sentTime"]',
      'span[class*="DateReceived"]',
      '[aria-label*="Ngày"]',
      '[aria-label*="Date"]',
      'time',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  /**
   * Lấy nội dung body email
   */
  function getBody() {
    const selectors = [
      '#ReadingPaneContainerId [role="document"]',
      'div[class*="Body"]',
      'div[class*="body"] [role="document"]',
      'div[class*="messageBody"]',
      'div[contenteditable="false"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  }

  /**
   * Lấy danh sách file đính kèm
   */
  function getAttachments() {
    const attachments = [];

    // Tìm các attachment trong Outlook Web
    const selectors = [
      'div[class*="attachment"] span[class*="fileName"]',
      'div[class*="Attachment"] span[class*="FileName"]',
      'span[aria-label*="attachment"]',
      'div[class*="attachmentWrapper"] a',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const name = el.textContent.trim();
        if (name) {
          attachments.push({
            name: name,
            downloadUrl: el.closest('a')?.href || '',
          });
        }
      });
    }

    return attachments;
  }

  /**
   * Lấy email ID từ URL hoặc DOM
   */
  function getEmailId() {
    // Outlook Web URL format: https://outlook.office.com/mail/inbox/id/AAMk...
    const match = window.location.href.match(/\/([A-Za-z0-9+=]+)$/);
    return match ? match[1] : '';
  }

  /**
   * Tạo cache key duy nhất cho email
   */
  function generateCacheKey(data) {
    const raw = [
      data.subject,
      data.sender,
      data.sentDate,
      data.attachments.map((a) => a.name).sort().join(','),
    ].join('|||');

    // Simple hash (SHA-256 sẽ được tính ở backend)
    return raw;
  }
})();
