import { state } from './state.js';

export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  sidebarSearchInput: document.getElementById('sidebar-search-input'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
  messageSearchInput: document.getElementById('message-search-input'),
  messageSearchCount: document.getElementById('message-search-count'),
  messageSearchPrev: document.getElementById('message-search-prev'),
  messageSearchNext: document.getElementById('message-search-next'),
  messageSearchClear: document.getElementById('message-search-clear'),
  groupModal: document.getElementById('group-modal'),
  groupMemberList: document.getElementById('group-member-list'),
  inviteModal: document.getElementById('invite-modal'),
  inviteModalBody: document.getElementById('invite-modal-body'),
  typingIndicator: document.getElementById('typing-indicator') || null,
  attachmentInput: document.getElementById('attachment-input'),
  attachFileBtn: document.getElementById('attach-file-btn'),
  uploadStatus: document.getElementById('upload-status')
};

const ATTACHMENT_PREFIX = '[[ATTACHMENT_V1]]';

function parseAttachment(content) {
  if (typeof content !== 'string' || !content.startsWith(ATTACHMENT_PREFIX)) return null;
  try {
    const item = JSON.parse(content.slice(ATTACHMENT_PREFIX.length));
    if (!item || typeof item.url !== 'string' || typeof item.name !== 'string') return null;
    return {
      name: item.name,
      mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
      size: Number(item.size) || 0,
      url: item.url
    };
  } catch (_) {
    return null;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function appendLinkifiedText(container, text) {
  const source = String(text || '');
  const regex = /https?:\/\/[^\s<]+/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
    }

    // Avoid swallowing sentence punctuation into the URL.
    let url = match[0];
    let trailing = '';
    while (/[),.!?;:]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }

    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'message-link';
    container.appendChild(link);

    if (trailing) container.appendChild(document.createTextNode(trailing));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < source.length) {
    container.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function showAttachmentExpired(container, attachment) {
  container.innerHTML = '';
  const expired = document.createElement('div');
  expired.className = 'attachment-expired';
  expired.innerHTML = '<i class="fas fa-triangle-exclamation"></i><span></span>';
  expired.querySelector('span').textContent = `${attachment.name} — attachment expired / removed to save storage`;
  container.appendChild(expired);
}

function renderAttachment(container, attachment) {
  container.classList.add('attachment-content');

  const wrapper = document.createElement('div');
  wrapper.className = 'attachment-card';

  const mime = attachment.mime.toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');

  if (isImage) {
    const link = document.createElement('a');
    link.href = attachment.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.className = 'attachment-image';
    img.src = attachment.url;
    img.alt = attachment.name;
    img.loading = 'lazy';
    img.addEventListener('error', () => showAttachmentExpired(container, attachment), { once: true });
    link.appendChild(img);
    wrapper.appendChild(link);
  } else if (isVideo) {
    const video = document.createElement('video');
    video.className = 'attachment-video';
    video.src = attachment.url;
    video.controls = true;
    video.preload = 'metadata';
    video.addEventListener('error', () => showAttachmentExpired(container, attachment), { once: true });
    wrapper.appendChild(video);
  } else if (isAudio) {
    const audio = document.createElement('audio');
    audio.className = 'attachment-audio';
    audio.src = attachment.url;
    audio.controls = true;
    audio.preload = 'metadata';
    audio.addEventListener('error', () => showAttachmentExpired(container, attachment), { once: true });
    wrapper.appendChild(audio);
  }

  const meta = document.createElement('div');
  meta.className = 'attachment-meta';

  const icon = document.createElement('span');
  icon.className = 'attachment-file-icon';
  icon.innerHTML = `<i class="fas ${isImage ? 'fa-image' : isVideo ? 'fa-film' : isAudio ? 'fa-music' : 'fa-file'}"></i>`;

  const details = document.createElement('div');
  details.className = 'attachment-details';
  const name = document.createElement('div');
  name.className = 'attachment-name';
  name.textContent = attachment.name;
  const size = document.createElement('div');
  size.className = 'attachment-size';
  size.textContent = formatBytes(attachment.size);
  details.appendChild(name);
  details.appendChild(size);

  const download = document.createElement('a');
  download.className = 'attachment-download button is-small is-light';
  download.href = `${attachment.url}?download=1&name=${encodeURIComponent(attachment.name)}`;
  download.title = 'Download file';
  download.innerHTML = '<span class="icon is-small"><i class="fas fa-download"></i></span>';

  meta.appendChild(icon);
  meta.appendChild(details);
  meta.appendChild(download);
  wrapper.appendChild(meta);
  container.appendChild(wrapper);
}

function searchableMessageText(content) {
  const attachment = parseAttachment(content);
  return attachment ? attachment.name : String(content || '');
}

function renderMessageContent(container, content) {
  const attachment = parseAttachment(content);
  if (attachment) {
    renderAttachment(container, attachment);
  } else {
    appendLinkifiedText(container, content);
  }
}

let sidebarSearchQuery = '';
let messageSearchQuery = '';
let currentMessageSearchIndex = -1;
let messageSearchMatches = [];
let lastSearchConversationId = null;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export function renderLoginError(message) {
  if (el.loginError) el.loginError.textContent = message || '';
}

export function renderLoggedIn() {
  if (el.loginScreen) el.loginScreen.classList.add('is-hidden');
  if (el.app) el.app.classList.remove('is-hidden');
}

export function setSidebarSearchQuery(query) {
  sidebarSearchQuery = normalize(query);
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
}

export function setMessageSearchQuery(query) {
  messageSearchQuery = normalize(query);
  currentMessageSearchIndex = messageSearchQuery ? 0 : -1;
  renderActiveConversation();
}

export function clearMessageSearch() {
  messageSearchQuery = '';
  messageSearchMatches = [];
  currentMessageSearchIndex = -1;
  if (el.messageSearchInput) el.messageSearchInput.value = '';
  renderActiveConversation();
}

export function moveMessageSearch(direction) {
  if (!messageSearchMatches.length) return;

  if (currentMessageSearchIndex < 0) {
    currentMessageSearchIndex = 0;
  } else {
    currentMessageSearchIndex =
      (currentMessageSearchIndex + direction + messageSearchMatches.length) % messageSearchMatches.length;
  }

  renderActiveConversation();
}

function updateMessageSearchControls(matchCount) {
  if (el.messageSearchCount) {
    el.messageSearchCount.textContent = matchCount
      ? `${currentMessageSearchIndex + 1}/${matchCount}`
      : '0/0';
  }

  const hasConversation = Boolean(state.activeConversationId);
  const hasMatches = matchCount > 0;
  const hasQuery = Boolean(messageSearchQuery);

  if (el.messageSearchInput) el.messageSearchInput.disabled = !hasConversation;
  if (el.messageSearchPrev) el.messageSearchPrev.disabled = !hasMatches;
  if (el.messageSearchNext) el.messageSearchNext.disabled = !hasMatches;
  if (el.messageSearchClear) el.messageSearchClear.disabled = !hasQuery;
}

export function renderOnlineUsers(users, onlineUsersSet) {
  if (!el.onlineUsersList) return;
  el.onlineUsersList.innerHTML = '';

  const safeSet = onlineUsersSet instanceof Set ? onlineUsersSet : new Set();
  const safeUsers = Array.isArray(users) ? users : [];
  const usersWithDm = new Set();
  let renderedCount = 0;

  const sortedConversations = Array.from(state.conversations.entries()).sort((a, b) => {
    const timeA = a[1].lastMessageAt ? new Date(a[1].lastMessageAt).getTime() : 0;
    const timeB = b[1].lastMessageAt ? new Date(b[1].lastMessageAt).getTime() : 0;
    return timeB - timeA;
  });

  for (const [id, convo] of sortedConversations) {
    let title = '';
    let statusHtml = '';

    if (convo.isGroup) {
      title = convo.name || 'Group Chat';
      statusHtml = '<span class="status-dot group-icon"></span>';
    } else {
      const partner = convo.members.find(m => m !== state.username);
      title = partner || 'Unknown';
      if (partner) usersWithDm.add(partner);
      const isOnline = safeSet.has(partner);
      statusHtml = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>`;
    }

    if (sidebarSearchQuery && !normalize(title).includes(sidebarSearchQuery)) {
      continue;
    }

    const li = document.createElement('li');
    const isActive = id === state.activeConversationId;
    li.className = `user-list-item ${isActive ? 'active' : ''}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'sidebar-item-title';
    titleSpan.textContent = title;

    li.innerHTML = statusHtml;
    li.appendChild(titleSpan);

    const unreadCount = state.unreadCounts.get(id) || 0;
    if (unreadCount > 0) {
      li.classList.add('has-unread');

      const unreadBadge = document.createElement('span');
      unreadBadge.className = 'unread-badge';
      unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      unreadBadge.title = `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`;
      unreadBadge.setAttribute('aria-label', unreadBadge.title);
      li.appendChild(unreadBadge);
    }

    li.addEventListener('click', () => window.setActiveConversation(id));
    el.onlineUsersList.appendChild(li);
    renderedCount += 1;
  }

  const remainingUsers = safeUsers.filter(u => u !== state.username && !usersWithDm.has(u));

  for (const user of remainingUsers) {
    if (sidebarSearchQuery && !normalize(user).includes(sidebarSearchQuery)) {
      continue;
    }

    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    li.className = 'user-list-item';
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'sidebar-item-title';
    titleSpan.textContent = user;
    li.appendChild(titleSpan);

    li.addEventListener('click', async () => {
      window.setRequestedTarget(user);
      const { generateKey, exportKey } = await import('./crypto.js');
      const key = await generateKey();
      const rawKey = await exportKey(key);
      window.send({ type: 'start_dm', targetUsername: user, conversationKey: rawKey });
    });

    el.onlineUsersList.appendChild(li);
    renderedCount += 1;
  }

  if (renderedCount === 0) {
    const empty = document.createElement('li');
    empty.className = 'sidebar-search-empty';
    empty.textContent = sidebarSearchQuery
      ? 'No users or chats found.'
      : 'No users or chats yet.';
    el.onlineUsersList.appendChild(empty);
  }
}

export function renderActiveConversation() {
  if (!el.activeTitle || !el.messageHistory) return;

  const id = state.activeConversationId;

  if (id !== lastSearchConversationId) {
    lastSearchConversationId = id;
    messageSearchQuery = '';
    messageSearchMatches = [];
    currentMessageSearchIndex = -1;
    if (el.messageSearchInput) el.messageSearchInput.value = '';
  }

  if (!id) {
    el.activeTitle.textContent = 'Select a user';
    if (el.activeMembers) el.activeMembers.textContent = '';
    el.messageHistory.innerHTML = '<div class="has-text-centered has-text-grey mt-5">Select a user from the sidebar to start messaging</div>';
    updateMessageSearchControls(0);
    return;
  }

  const convo = state.conversations.get(id);
  if (!convo) return;

  if (convo.isGroup) {
    el.activeTitle.textContent = convo.name || 'Group Chat';
  } else if (convo.members.length === 2) {
    el.activeTitle.textContent = convo.members.find(m => m !== state.username) || 'Unknown';
  } else {
    el.activeTitle.textContent = convo.name || 'Group Chat';
  }

  if (el.activeMembers) el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;

  const query = messageSearchQuery;
  messageSearchMatches = [];

  if (query) {
    convo.messages.forEach((msg, index) => {
      if (normalize(searchableMessageText(msg.content)).includes(query)) {
        messageSearchMatches.push(index);
      }
    });
  }

  if (messageSearchMatches.length === 0) {
    currentMessageSearchIndex = -1;
  } else if (currentMessageSearchIndex < 0 || currentMessageSearchIndex >= messageSearchMatches.length) {
    currentMessageSearchIndex = 0;
  }

  const currentMatchedMessageIndex =
    currentMessageSearchIndex >= 0
      ? messageSearchMatches[currentMessageSearchIndex]
      : -1;

  el.messageHistory.innerHTML = '';

  convo.messages.forEach((msg, messageIndex) => {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === state.username ? 'message-sent' : 'message-received'}`;
    div.dataset.messageIndex = String(messageIndex);

    if (messageSearchMatches.includes(messageIndex)) {
      div.classList.add('search-match');
    }
    if (messageIndex === currentMatchedMessageIndex) {
      div.classList.add('search-match-current');
    }

    const timestamp = msg.createdAt || msg.created_at;

    div.innerHTML = `
      <span class="sender"></span>
      <span class="time"></span>
      <div class="content"></div>
    `;
    div.querySelector('.sender').textContent = msg.senderId;
    div.querySelector('.time').textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    renderMessageContent(div.querySelector('.content'), msg.content);
    el.messageHistory.appendChild(div);
  });

  updateMessageSearchControls(messageSearchMatches.length);

  if (query && currentMatchedMessageIndex >= 0) {
    const currentMatch = el.messageHistory.querySelector(`[data-message-index="${currentMatchedMessageIndex}"]`);
    if (currentMatch) {
      requestAnimationFrame(() => {
        currentMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  } else if (!query) {
    el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
  }
}

export function renderTypingIndicator() {
  if (!el.typingIndicator) return;

  const id = state.activeConversationId;
  if (!id) return;

  const typingUsers = [];
  if (state.typingUsers && state.typingUsers.has(id)) {
    for (const username of state.typingUsers.get(id)) {
      if (username !== state.username) typingUsers.push(username);
    }
  }

  if (typingUsers.length > 0) {
    el.typingIndicator.textContent = `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`;
    el.typingIndicator.style.display = 'block';
  } else {
    el.typingIndicator.style.display = 'none';
  }
}

export function renderAll() {
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
  renderActiveConversation();
}

export function renderGroupModal(users) {
  if (!el.groupMemberList) return;
  el.groupMemberList.innerHTML = '';
  const safeUsers = Array.isArray(users) ? users : [];

  for (const user of safeUsers) {
    if (user === state.username) continue;

    const div = document.createElement('div');
    div.className = 'group-member-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `user-${user}`;
    checkbox.value = user;

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = user;

    div.appendChild(checkbox);
    div.appendChild(label);
    el.groupMemberList.appendChild(div);
  }
}

export function renderInvites() {
  if (!el.inviteModalBody) return;
  el.inviteModalBody.innerHTML = '';
  const invites = Array.from(state.pendingInvites.values());

  if (invites.length === 0) {
    el.inviteModalBody.innerHTML = '<p class="has-text-centered has-text-grey">No pending invitations.</p>';
    return;
  }

  for (const invite of invites) {
    const div = document.createElement('div');
    div.className = 'invite-item box mb-3';

    const text = document.createElement('p');
    text.className = 'mb-2';
    text.textContent = `${invite.inviter} invited you to join ${invite.name || 'a group'}.`;

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.innerHTML = `
      <button class="button is-success is-small" data-action="accept" data-id="${invite.conversationId}">Accept</button>
      <button class="button is-danger is-small" data-action="decline" data-id="${invite.conversationId}">Decline</button>
    `;

    div.appendChild(text);
    div.appendChild(buttons);
    el.inviteModalBody.appendChild(div);
  }
}

export function closeInviteModal() {
  if (el.inviteModal) {
    el.inviteModal.classList.remove('is-active');
  }
}
