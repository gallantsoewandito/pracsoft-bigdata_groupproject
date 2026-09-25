import { state } from './state.js';

export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
  groupModal: document.getElementById('group-modal'),
  groupMemberList: document.getElementById('group-member-list'),
  typingIndicator: document.getElementById('typing-indicator') || null // Safe fallback
};

export function renderLoginError(message) {
  if (el.loginError) el.loginError.textContent = message || '';
}

export function renderLoggedIn() {
  if (el.loginScreen) el.loginScreen.classList.add('is-hidden');
  if (el.app) el.app.classList.remove('is-hidden');
}

export function renderOnlineUsers(users, onlineUsersSet) {
  if (!el.onlineUsersList) return;
  el.onlineUsersList.innerHTML = '';

  const safeSet = onlineUsersSet instanceof Set ? onlineUsersSet : new Set();
  const safeUsers = Array.isArray(users) ? users : [];

  // Track which users already have a direct message conversation to avoid duplicates
  const usersWithDm = new Set();

  // 1. Render all active conversations (Groups and Direct Messages)
  const sortedConversations = Array.from(state.conversations.entries()).sort((a, b) => {
    const timeA = a[1].lastMessageAt ? new Date(a[1].lastMessageAt).getTime() : 0;
    const timeB = b[1].lastMessageAt ? new Date(b[1].lastMessageAt).getTime() : 0;
    return timeB - timeA;
  });

  for (const [id, convo] of sortedConversations) {
    const li = document.createElement('li');
    const isActive = id === state.activeConversationId;
    li.className = `user-list-item ${isActive ? 'active' : ''}`;

    let title = '';
    let statusHtml = '';

    if (convo.isGroup) {
      title = convo.name || 'Group Chat';
      statusHtml = '<span class="status-dot group-icon"></span>';
    } else {
      const partner = convo.members.find(m => m !== state.username);
      title = partner || 'Unknown';
      usersWithDm.add(partner);
      const isOnline = safeSet.has(partner);
      statusHtml = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>`;
    }

    li.innerHTML = `${statusHtml} ${title}`;
    li.addEventListener('click', () => window.setActiveConversation(id));
    el.onlineUsersList.appendChild(li);
  }

  // 2. Render remaining users from the database who do not have a chat yet
  const remainingUsers = safeUsers.filter(u => u !== state.username && !usersWithDm.has(u));

  for (const user of remainingUsers) {
    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    li.className = 'user-list-item';
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span> ${user}`;

    li.addEventListener('click', async () => {
      window.setRequestedTarget(user);
      const { generateKey, exportKey } = await import('./crypto.js');
      const key = await generateKey();
      const rawKey = await exportKey(key);
      window.send({ type: 'start_dm', targetUsername: user, conversationKey: rawKey });
    });

    el.onlineUsersList.appendChild(li);
  }
}

export function renderActiveConversation() {
  if (!el.activeTitle || !el.messageHistory) return;
  
  const id = state.activeConversationId;
  
  if (!id) {
    el.activeTitle.textContent = 'Select a user';
    if (el.activeMembers) el.activeMembers.textContent = '';
    el.messageHistory.innerHTML = '<div class="has-text-centered has-text-grey mt-5">Select a user from the sidebar to start messaging</div>';
    return;
  }

  const convo = state.conversations.get(id);
  if (!convo) return;
  
  if (convo.members.length === 2) {
    el.activeTitle.textContent = convo.members.find(m => m !== state.username) || "Unknown";
  } else {
    el.activeTitle.textContent = "Group Chat";
  }
  
  if (el.activeMembers) el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;

  el.messageHistory.innerHTML = '';
  for (const msg of convo.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === state.username ? 'message-sent' : 'message-received'}`;
    const timestamp = msg.createdAt || msg.created_at;
    
    div.innerHTML = `
      <span class="sender">${msg.senderId}</span>
      <span class="time">${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <div class="content"></div>
    `;
    div.querySelector('.content').textContent = msg.content;
    el.messageHistory.appendChild(div);
  }
  el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
}

export function renderTypingIndicator() {
  if (!el.typingIndicator) return;
  
  const id = state.activeConversationId;
  if (!id) return;

  const typingUsers = [];
  if (state.typing && state.typing.has(id)) {
    for (const [username, isTyping] of state.typing.get(id)) {
      if (isTyping && username !== state.username) {
        typingUsers.push(username);
      }
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
    div.innerHTML = `
      <input type="checkbox" id="user-${user}" value="${user}">
      <label for="user-${user}">${user}</label>
    `;
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
    div.innerHTML = `
      <p class="mb-2"><strong>${invite.inviter}</strong> invited you to join <strong>${invite.name || 'a group'}</strong>.</p>
      <div class="buttons">
        <button class="button is-success is-small" data-action="accept" data-id="${invite.conversationId}">Accept</button>
        <button class="button is-danger is-small" data-action="decline" data-id="${invite.conversationId}">Decline</button>
      </div>
    `;
    el.inviteModalBody.appendChild(div);
  }
}

export function closeInviteModal() {
  if (el.inviteModal) {
    el.inviteModal.classList.remove('is-active');
  }
}