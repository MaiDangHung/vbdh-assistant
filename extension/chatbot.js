/**
 * VBDH Assistant — Chatbot Floating Widget
 * Injected into QLVBDH page when chatbot is enabled for the user.
 */
(function() {
  'use strict';

  const CHATBOT_ID = 'vbdh-chatbot-widget';
  let isVisible = false;
  let conversations = [];
  let activeConvId = null;
  let chatLoading = false;
  let config = { apiBase: '', token: '', chatbotEnabled: false };

  // Load config from script tag data attributes (set by content.js)
  function initFromScript() {
    const script = document.getElementById('vbdh-chatbot-script');
    if (!script) return;
    const cfg = {
      apiBase: script.dataset.apiBase || '',
      token: script.dataset.token || '',
      chatbotEnabled: script.dataset.token ? true : false,
    };
    if (!cfg.chatbotEnabled || !cfg.token) return;
    config = cfg;
    injectStyles();
    createWidget();
    loadConversations();
  }

  // Auto-init when script loads
  initFromScript();

  // ===== Styles =====
  function injectStyles() {
    if (document.getElementById('vbdh-chatbot-styles')) return;
    const style = document.createElement('style');
    style.id = 'vbdh-chatbot-styles';
    style.textContent = `
      #vbdh-chatbot-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 99999;
        width: 52px; height: 52px; border-radius: 50%;
        background: linear-gradient(135deg, #1677ff, #4096ff);
        border: none; cursor: pointer;
        box-shadow: 0 4px 12px rgba(22,119,255,0.4);
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        color: #fff; font-size: 24px;
      }
      #vbdh-chatbot-btn:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(22,119,255,0.5); }
      #vbdh-chatbot-btn.loading { animation: chatbotPulse 1.5s infinite; }
      @keyframes chatbotPulse {
        0%, 100% { box-shadow: 0 4px 12px rgba(22,119,255,0.4); }
        50% { box-shadow: 0 4px 20px rgba(22,119,255,0.8); }
      }

      #vbdh-chatbot-panel {
        position: fixed; bottom: 88px; right: 24px; z-index: 99998;
        width: 400px; height: 520px;
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        display: none; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
        animation: chatbotSlideUp 0.25s ease;
      }
      @keyframes chatbotSlideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .chat-header {
        background: linear-gradient(135deg, #1677ff, #4096ff);
        color: #fff; padding: 14px 18px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .chat-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
      .chat-header-actions { display: flex; gap: 6px; }
      .chat-header-btn {
        background: rgba(255,255,255,0.2); border: none; color: #fff;
        width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 14px;
      }
      .chat-header-btn:hover { background: rgba(255,255,255,0.35); }

      .chat-messages {
        flex: 1; overflow-y: auto; padding: 14px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .chat-msg {
        display: flex; gap: 8px; max-width: 85%;
      }
      .chat-msg.user { align-self: flex-end; flex-direction: row-reverse; }
      .chat-msg.assistant { align-self: flex-start; }

      .chat-avatar {
        width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; color: #fff;
      }
      .chat-msg.user .chat-avatar { background: #1677ff; }
      .chat-msg.assistant .chat-avatar { background: #52c41a; }

      .chat-bubble {
        padding: 10px 14px; border-radius: 14px;
        font-size: 13.5px; line-height: 1.55;
        white-space: pre-wrap; word-break: break-word;
      }
      .chat-msg.user .chat-bubble { background: #1677ff; color: #fff; border-bottom-right-radius: 4px; }
      .chat-msg.assistant .chat-bubble { background: #f0f0f0; color: #333; border-bottom-left-radius: 4px; }

      .chat-typing { display: flex; gap: 4px; padding: 8px 14px; }
      .chat-typing span {
        width: 6px; height: 6px; background: #999; border-radius: 50%;
        animation: typingDot 1.2s infinite;
      }
      .chat-typing span:nth-child(2) { animation-delay: 0.2s; }
      .chat-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typingDot {
        0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
        30% { opacity: 1; transform: scale(1); }
      }

      .chat-input-area {
        padding: 10px 14px; border-top: 1px solid #eee;
        display: flex; gap: 8px; align-items: flex-end;
      }
      .chat-input {
        flex: 1; border: 1px solid #d9d9d9; border-radius: 10px;
        padding: 8px 12px; font-size: 13.5px; resize: none;
        outline: none; max-height: 80px; min-height: 36px;
        font-family: inherit;
      }
      .chat-input:focus { border-color: #1677ff; }
      .chat-send {
        width: 36px; height: 36px; border-radius: 50%;
        background: #1677ff; border: none; color: #fff;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      .chat-send:hover { background: #4096ff; }
      .chat-send:disabled { background: #d9d9d9; cursor: not-allowed; }

      .chat-empty {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        color: #999; gap: 8px; padding: 20px;
      }
      .chat-empty-icon { font-size: 40px; }
      .chat-empty-text { font-size: 13px; text-align: center; }

      .chat-conv-item {
        padding: 8px 12px; cursor: pointer; border-radius: 8px;
        display: flex; justify-content: space-between; align-items: center;
        transition: background 0.15s;
      }
      .chat-conv-item:hover { background: #f5f5f5; }
      .chat-conv-item.active { background: #e6f4ff; }
      .chat-conv-item span { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chat-conv-del {
        background: none; border: none; color: #999; cursor: pointer; font-size: 12px;
        padding: 2px 4px; border-radius: 4px;
      }
      .chat-conv-del:hover { color: #ff4d4f; background: #fff1f0; }

      .chat-sidebar { padding: 12px; overflow-y: auto; flex: 1; }
    `;
    document.head.appendChild(style);
  }

  // ===== Widget Creation =====
  function createWidget() {
    if (document.getElementById('vbdh-chatbot-btn')) return;
    // Mark widget as initialized
    const marker = document.createElement('div');
    marker.id = CHATBOT_ID;
    marker.style.display = 'none';
    document.body.appendChild(marker);

    // Floating button
    const btn = document.createElement('button');
    btn.id = 'vbdh-chatbot-btn';
    btn.innerHTML = '🤖';
    btn.title = 'Trợ lý AI';
    btn.addEventListener('click', toggleChat);
    document.body.appendChild(btn);

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'vbdh-chatbot-panel';
    panel.innerHTML = `
      <div class="chat-header">
        <h3>🤖 Trợ lý AI</h3>
        <div class="chat-header-actions">
          <button class="chat-header-btn" id="chat-new-btn" title="Cuộc trò chuyện mới">➕</button>
          <button class="chat-header-btn" id="chat-list-btn" title="Danh sách">📋</button>
          <button class="chat-header-btn" id="chat-close-btn" title="Đóng">✕</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input" placeholder="Nhập tin nhắn..." rows="1"></textarea>
        <button class="chat-send" id="chat-send-btn">➤</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('chat-close-btn').addEventListener('click', () => toggleChat(false));
    document.getElementById('chat-new-btn').addEventListener('click', createConversation);
    document.getElementById('chat-list-btn').addEventListener('click', toggleConversationList);
    document.getElementById('chat-send-btn').addEventListener('click', sendMessage);

    const input = document.getElementById('chat-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });
  }

  function toggleChat(forceState) {
    const panel = document.getElementById('vbdh-chatbot-panel');
    if (!panel) return;
    isVisible = typeof forceState === 'boolean' ? forceState : !isVisible;
    panel.style.display = isVisible ? 'flex' : 'none';
  }

  // ===== API Calls =====
  async function apiCall(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${config.apiBase}/api/v1/chatbot${path}`, opts);
    return res.json();
  }

  // ===== Conversations =====
  async function loadConversations() {
    try {
      const res = await apiCall('GET', '/conversations');
      conversations = res.data || [];
    } catch (e) {
      console.warn('[Chatbot] Load conversations failed:', e);
    }
  }

  async function createConversation() {
    try {
      const res = await apiCall('POST', '/conversations');
      if (res.data) {
        conversations.unshift(res.data);
        activeConvId = res.data.id;
        renderMessages([]);
        toggleChat(true);
        showChatView();
      }
    } catch (e) {
      console.error('[Chatbot] Create conversation failed:', e);
    }
  }

  async function selectConversation(convId) {
    activeConvId = convId;
    showingConvList = false;
    try {
      const res = await apiCall('GET', `/conversations/${convId}/messages`);
      renderMessages(res.data || []);
    } catch (e) {
      renderMessages([]);
    }
  }

  async function deleteConversation(convId, e) {
    if (e) { e.stopPropagation(); }
    try {
      await apiCall('DELETE', `/conversations/${convId}`);
      conversations = conversations.filter(c => c.id !== convId);
      if (activeConvId === convId) {
        activeConvId = null;
        renderMessages([]);
      }
      showConversationList();
    } catch (err) {
      console.error('[Chatbot] Delete failed:', err);
    }
  }

  // ===== Chat =====
  let currentAbortController = null;

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const text = input.value.trim();
    if (!text || chatLoading) return;

    input.value = '';
    input.style.height = 'auto';
    chatLoading = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '⏳';

    // Show loading on floating button
    const chatBtn = document.getElementById('vbdh-chatbot-btn');
    if (chatBtn) chatBtn.classList.add('loading');
    // Disable input
    input.disabled = true;

    // Add user message to UI
    appendMessage('user', text);

    // Show typing indicator
    const typingEl = showTyping();

    // Abort previous request if still pending
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    try {
      const opts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          conversationId: activeConvId,
          message: text,
        }),
        signal: currentAbortController.signal,
      };
      const res = await fetch(`${config.apiBase}/api/v1/chatbot/chat`, opts);
      const data = await res.json();
      if (data.data) {
        // If backend auto-created conversation, save the ID
        if (data.data.conversationId && !activeConvId) {
          activeConvId = data.data.conversationId;
        }
        appendMessage('assistant', data.data.content);
      } else {
        appendMessage('assistant', '❌ Không nhận được phản hồi. Vui lòng thử lại.');
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // Previous request aborted, ignore
      appendMessage('assistant', '❌ Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      typingEl.remove();
      chatLoading = false;
      currentAbortController = null;
      sendBtn.disabled = false;
      sendBtn.innerHTML = '➤';
      // Remove loading from floating button
      const chatBtn = document.getElementById('vbdh-chatbot-btn');
      if (chatBtn) chatBtn.classList.remove('loading');
      // Re-enable input
      const inp = document.getElementById('chat-input');
      if (inp) inp.disabled = false;
    }
  }

  // ===== Rendering =====
  function renderMessages(msgs) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (msgs.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">🤖</div>
          <div class="chat-empty-text">Xin chào! Tôi là trợ lý AI.<br>Hãy hỏi tôi về nhiệm vụ, văn bản, tiến độ công việc...</div>
        </div>`;
      return;
    }

    container.innerHTML = msgs.map(m => `
      <div class="chat-msg ${m.role}">
        <div class="chat-avatar">${m.role === 'user' ? '👤' : '🤖'}</div>
        <div class="chat-bubble">${escapeHtml(m.content)}</div>
      </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  }

  function appendMessage(role, content) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Remove empty state
    const empty = container.querySelector('.chat-empty');
    if (empty) empty.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = `
      <div class="chat-avatar">${role === 'user' ? '👤' : '🤖'}</div>
      <div class="chat-bubble">${escapeHtml(content)}</div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping() {
    const container = document.getElementById('chat-messages');
    const typing = document.createElement('div');
    typing.className = 'chat-msg assistant';
    typing.innerHTML = `
      <div class="chat-avatar">🤖</div>
      <div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>
    `;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    return typing;
  }

  let showingConvList = false;

  function toggleConversationList() {
    if (showingConvList) {
      showChatView();
    } else {
      showConversationList();
    }
  }

  function showConversationList() {
    showingConvList = true;
    const container = document.getElementById('chat-messages');
    if (conversations.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <div class="chat-empty-text">Chưa có cuộc trò chuyện.<br>Nhấn ➕ để bắt đầu.</div>
        </div>`;
      return;
    }
    container.innerHTML = '<div class="chat-sidebar">' +
      conversations.map(c => `
        <div class="chat-conv-item ${c.id === activeConvId ? 'active' : ''}" data-conv-id="${c.id}">
          <span>💬 ${escapeHtml(c.title)}</span>
          <button class="chat-conv-del" data-del-id="${c.id}" title="Xóa">🗑️</button>
        </div>
      `).join('') +
    '</div>';

    // Bind click events
    container.querySelectorAll('.chat-conv-item').forEach(el => {
      el.addEventListener('click', () => selectConversation(el.dataset.convId));
    });
    container.querySelectorAll('.chat-conv-del').forEach(el => {
      el.addEventListener('click', (e) => deleteConversation(el.dataset.delId, e));
    });
  }

  function showChatView() {
    showingConvList = false;
    if (activeConvId) {
      // Don't call selectConversation again — just render empty
      renderMessages([]);
    } else {
      renderMessages([]);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Auto-init complete =====
})();
