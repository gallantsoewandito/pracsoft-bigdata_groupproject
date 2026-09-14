import { state } from './state.js';

export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  leaveBtn: document.getElementById('leave-conversation-btn'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
  groupModal: document.getElementById('group-modal'),
  groupMemberList: document.getElementById('group-member-list'),
};

export function renderLoginError(message) {
  el.loginError.textContent = message || '';
}

export function renderLoggedIn() {
  el.loginScreen.classList.add('is-hidden');
  el.app.classList.remove('is-hidden');
}

export function renderOnlineUsers(users, onlineUsersSet) {
  el.onlineUsersList.innerHTML = '';
  const safeUsers = Array.isArray(users) ? users : [];
  const safeSet = onlineUsersSet instanceof Set ? onlineUsersSet : new Set();

  // Check if current active chat is a DM
  const activeConvo = state.conversations.get(state.activeConversationId);
  const isDmActive = activeConvo && activeConvo.members.length === 2;
  const activeDmPartner = isDmActive ? activeConvo.members.find(m => m !== state.username) : null;

  for (const user of safeUsers) {
    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    const isActive = user === activeDmPartner;
    
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span> ${user} ${user === state.username ? '(you)' : ''}`;
    li.className = `user-list-item ${isActive ? 'active' : ''}`;
    
    li.addEventListener('click', () => {
      if (user !== state.username) {
        console.log('🖱️ Clicked user:', user);
        window.send({ type: 'start_dm', targetUsername: user });
      }
    });
    
    el.onlineUsersList.appendChild(li);
  }
}

export function renderActiveConversation() {
  const id = state.activeConversationId;
  console.log('🎨 Rendering active conversation, ID:', id);
  
  if (!id) {
    el.activeTitle.textContent = 'Select a user';
    el.activeMembers.textContent = '';
    el.leaveBtn.classList.add('is-hidden');
    el.messageHistory.innerHTML = '<div class="has-text-centered has-text-grey mt-5">Select a user from the sidebar to start messaging</div>';
    return;
  }

  const convo = state.conversations.get(id);
  
  if (convo.members.length === 2) {
    el.activeTitle.textContent = convo.members.find(m => m !== state.username) || "Unknown";
  } else {
    el.activeTitle.textContent = "Group Chat";
  }
  
  el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;
  el.leaveBtn.classList.remove('is-hidden');

  el.messageHistory.innerHTML = '';
  for (const msg of convo.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === state.username ? 'message-sent' : 'message-received'}`;
    const timestamp = msg.createdAt || msg.created_at;
    
    div.innerHTML = `
      <span class="sender">${msg.senderId}</span>
      <span class="time">${new Date(timestamp).toLocaleTimeString()}</span>
      <div class="content"></div>
    `;
    div.querySelector('.content').textContent = msg.content;
    el.messageHistory.appendChild(div);
  }
  el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
}

export function renderAll() {
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
  renderActiveConversation();
}

export function renderGroupModal(users) {
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