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
  
  const safeUsers = Array.isArray(users) ? users : [];
  const safeSet = onlineUsersSet instanceof Set ? onlineUsersSet : new Set();

  // Check if current active chat is a DM
  const activeConvo = state.conversations.get(state.activeConversationId);
  const isDmActive = activeConvo && activeConvo.members.length === 2;
  const activeDmPartner = isDmActive ? activeConvo.members.find(m => m !== state.username) : null;

  // Sort users: Active chats first (by latest message), then alphabetical
  const sortedUsers = [...safeUsers].sort((a, b) => {
    let timeA = 0;
    let timeB = 0;

    for (const [, convo] of state.conversations) {
      if (convo.members.length === 2 && convo.members.includes(a) && convo.members.includes(state.username)) {
        timeA = convo.lastMessageAt ? new Date(convo.lastMessageAt).getTime() : 0;
      }
      if (convo.members.length === 2 && convo.members.includes(b) && convo.members.includes(state.username)) {
        timeB = convo.lastMessageAt ? new Date(convo.lastMessageAt).getTime() : 0;
      }
    }

    if (timeA === 0 && timeB === 0) return a.localeCompare(b);
    if (timeA === 0) return 1;
    if (timeB === 0) return -1;
    return timeB - timeA;
  });

  for (const user of sortedUsers) {
    if (user === state.username) continue; // Don't show yourself in the user list

    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    const isActive = user === activeDmPartner;
    
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span> ${user}`;
    li.className = `user-list-item ${isActive ? 'active' : ''}`;
    
    li.addEventListener('click', async () => {
      if (user !== state.username) {
        console.log('Clicked user:', user);
        window.setRequestedTarget(user);
        
        // Generate a single, simple AES key for this conversation
        const { generateKey, exportKey } = await import('./crypto.js');
        const key = await generateKey();
        const rawKey = await exportKey(key);
        
        window.send({ type: 'start_dm', targetUsername: user, conversationKey: rawKey });
      }
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