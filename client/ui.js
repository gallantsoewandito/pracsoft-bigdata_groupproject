import { state } from './state.js';
import { generateKey, exportKey } from './crypto.js';

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
  typingIndicator: document.getElementById('typing-indicator'),
};

export function renderTypingIndicator() {
  const id = state.activeConversationId;
  if (!id) {
    el.typingIndicator.textContent = '';
    return;
  }
  const typingSet = state.typingUsers.get(id);
  if (!typingSet || typingSet.size === 0) {
    el.typingIndicator.textContent = '';
    return;
  }
  const names = Array.from(typingSet);
  el.typingIndicator.textContent = names.length === 1
    ? `${names[0]} is typing...`
    : `${names.join(', ')} are typing...`;
}

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
  })

  for (const user of sortedUsers) {
    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    const isActive = user === activeDmPartner;
    
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span> ${user} ${user === state.username ? '(you)' : ''}`;
    li.className = `user-list-item ${isActive ? 'active' : ''}`;
    
    li.addEventListener('click', async () => {
      if (user !== state.username) {
        console.log('Clicked user:', user);
        window.setRequestedTarget(user);
        
        const key = await generateKey();
        const rawKey = await exportKey(key);
        
        window.send({ type: 'start_dm', targetUsername: user, conversationKey: rawKey });
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
  renderTypingIndicator();
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