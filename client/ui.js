import { state } from './state.js';

export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  conversationList: document.getElementById('conversation-list'),
  inviteModal: document.getElementById('invite-modal'),
  inviteModalBody: document.getElementById('invite-modal-body'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
  groupModal: document.getElementById('group-modal'),
  groupMemberList: document.getElementById('group-member-list'),
  typingIndicator: document.getElementById('typing-indicator'),
  leaveGroupButton: document.getElementById('leave-group-btn'),
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

let inviteModalFrom = null;

export function openInviteModal(inviter) {
  inviteModalFrom = inviter;
  el.inviteModal.classList.add('is-active');
  renderInviteModal();
}

export function closeInviteModal() {
  inviteModalFrom = null;
  el.inviteModal.classList.remove('is-active');
}

export function renderInviteModal() {
  if (!inviteModalFrom) return;
  const invites = [...state.pendingInvites.values()].filter(i => i.inviter === inviteModalFrom);
  if (invites.length === 0) {
    closeInviteModal();
    return;
  }
  el.inviteModalBody.innerHTML = '';
  for (const invite of invites) {
    const box = document.createElement('div');
    box.className = 'invite-item';

    const text = document.createElement('span');
    text.className = 'invite-text';
    const who = document.createElement('strong');
    who.textContent = invite.inviter;
    text.append(who, ` has invited you into a group chat named "${invite.name || 'Untitled group'}".`);

    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    const accept = document.createElement('button');
    accept.className = 'button is-success is-small';
    accept.dataset.action = 'accept';
    accept.dataset.id = invite.conversationId;
    accept.textContent = 'Accept';
    const decline = document.createElement('button');
    decline.className = 'button is-light is-small';
    decline.dataset.action = 'decline';
    decline.dataset.id = invite.conversationId;
    decline.textContent = 'Decline';
    actions.append(accept, decline);

    box.append(text, actions);
    el.inviteModalBody.appendChild(box);
  }
}

function conversationLabel(convo) {
  if (convo.isGroup) return convo.name || 'Untitled group';
  const others = convo.members.filter(m => m !== state.username);
  return others[0] || 'Unknown';
}

export function renderConversationList() {
  el.conversationList.innerHTML = '';

  const entries = [...state.conversations.entries()].sort(([, a], [, b]) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'is-size-7 has-text-grey p-2';
    li.textContent = 'No conversations yet';
    el.conversationList.appendChild(li);
    return;
  }

  for (const [id, convo] of entries) {
    const li = document.createElement('li');
    li.className = `conversation-item ${id === state.activeConversationId ? 'active' : ''}`;

    const icon = document.createElement('span');
    icon.className = 'conversation-icon';
    icon.innerHTML = `<i class="fas ${convo.isGroup ? 'fa-users' : 'fa-user'}"></i>`;

    const body = document.createElement('div');
    body.className = 'conversation-body';
    const name = document.createElement('div');
    name.className = 'conversation-name';
    name.textContent = conversationLabel(convo);
    const preview = document.createElement('div');
    preview.className = 'conversation-preview';
    const last = convo.messages[convo.messages.length - 1];
    preview.textContent = last
      ? `${last.senderId === state.username ? 'You' : last.senderId}: ${last.content}`
      : 'No messages yet';
    body.append(name, preview);
    li.append(icon, body);

    const unread = state.unreadCounts.get(id) || 0;
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      li.appendChild(badge);
    }

    li.addEventListener('click', () => window.setActiveConversation(id));
    el.conversationList.appendChild(li);
  }
}

export function renderInvites() {
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
  renderInviteModal();
}

export function renderLoginError(message) {
  el.loginError.textContent = message || '';
  if (message) {
    const btn = document.getElementById('auth-btn');
    btn.disabled = false;
    const isLogin = document.getElementById('toggle-auth-mode').textContent.startsWith('Need');
    btn.textContent = isLogin ? 'Log In' : 'Sign Up';
  }
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
  const isDmActive = activeConvo && !activeConvo.isGroup;
  const activeDmPartner = isDmActive ? activeConvo.members.find(m => m !== state.username) : null;

  const sortedUsers = [...safeUsers].sort((a, b) => {
    let timeA = 0;
    let timeB = 0;

    for (const [, convo] of state.conversations) {
      if (!convo.isGroup && convo.members.includes(a) && convo.members.includes(state.username)) {
        timeA = convo.lastMessageAt ? new Date(convo.lastMessageAt).getTime() : 0;
      }
      if (!convo.isGroup && convo.members.includes(b) && convo.members.includes(state.username)) {
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
    li.className = `user-list-item ${isActive ? 'active' : ''}`;

    const dot = document.createElement('span');
    dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    const label = document.createElement('span');
    label.textContent = user + (user === state.username ? ' (you)' : '');
    li.append(dot, label);

    const hasInvite = [...state.pendingInvites.values()].some(i => i.inviter === user);
    if (hasInvite) {
      const flag = document.createElement('button');
      flag.type = 'button';
      flag.className = 'invite-flag';
      flag.title = 'This user invited you to a group chat';
      flag.textContent = '!';
      flag.addEventListener('click', (e) => {
        e.stopPropagation();
        openInviteModal(user);
      });
      li.appendChild(flag);
    }

    li.addEventListener('click', async () => {
      if (user !== state.username) {
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
    el.leaveGroupButton.classList.add('is-hidden');
    el.typingIndicator.textContent = '';
    return;
  }

  const convo = state.conversations.get(id);
  if (!convo) return;
  
  el.activeTitle.textContent = conversationLabel(convo);
  el.leaveGroupButton.classList.toggle('is-hidden', !convo.isGroup);
  
  el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;

  el.messageHistory.innerHTML = '';
  for (const msg of convo.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === state.username ? 'message-sent' : 'message-received'}`;
    const timestamp = msg.createdAt || msg.created_at;

    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = msg.senderId;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(timestamp).toLocaleTimeString();
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = msg.content;

    div.append(sender, time, content);
    el.messageHistory.appendChild(div);
  }
  el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
  renderTypingIndicator();
}

export function renderAll() {
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
  renderConversationList();
  renderActiveConversation();
  renderInviteModal();
}

export function renderGroupModal(users) {
  el.groupMemberList.innerHTML = '';
  const safeUsers = Array.isArray(users) ? users : [];
  
  for (const user of safeUsers) {
    if (user === state.username) continue;
    
    const label = document.createElement('label');
    label.className = 'group-member-item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = user;
    const name = document.createElement('span');
    name.textContent = user;
    label.append(box, name);
    el.groupMemberList.appendChild(label);
  }
}
