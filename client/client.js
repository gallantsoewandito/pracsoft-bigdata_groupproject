import { state, removeConversation } from './state.js';
import { el, renderLoginError, renderAll, renderGroupModal, closeInviteModal } from './ui.js';
import { connect, send, setActiveConversation, setRequestedTarget, setRequestedGroupId } from './network.js';
import { generateKey, exportKey, encryptText } from './crypto.js';

// Expose functions to the window object
window.state = state;
window.send = send;
window.setActiveConversation = setActiveConversation;
window.setRequestedTarget = setRequestedTarget;
window.setRequestedGroupId = setRequestedGroupId;

const passwordInput = document.getElementById('password-input');
const authBtn = document.getElementById('auth-btn');
const toggleAuthMode = document.getElementById('toggle-auth-mode');
let isLoginMode = true;
let typingTimeout = null;
let isCurrentlyTyping = false;
let typingConversationId = null;

function stopTyping() {
  clearTimeout(typingTimeout);
  if (isCurrentlyTyping && typingConversationId) {
    send({ type: 'typing', conversationId: typingConversationId, isTyping: false });
  }
  isCurrentlyTyping = false;
  typingConversationId = null;
}

// ✅ SAFE: Only add listener if the element exists
if (el.messageInput) {
  el.messageInput.addEventListener('input', () => {
    const conversationId = state.activeConversationId;
    if (!conversationId) return;
    if (isCurrentlyTyping && typingConversationId !== conversationId) stopTyping();
    if (!isCurrentlyTyping) {
      isCurrentlyTyping = true;
      typingConversationId = conversationId;
      send({ type: 'typing', conversationId, isTyping: true });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 2000);
  });
}

if (toggleAuthMode) {
  toggleAuthMode.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
      authBtn.textContent = 'Log In';
      toggleAuthMode.textContent = 'Need an account? Sign Up';
    } else {
      authBtn.textContent = 'Sign Up';
      toggleAuthMode.textContent = 'Already have an account? Log In';
    }
    renderLoginError('');
  });
}

if (authBtn) {
  authBtn.addEventListener('click', () => {
    const username = document.getElementById('username-input').value.trim();
    const password = passwordInput ? passwordInput.value : '';
    if (!username || !password) {
      renderLoginError('Please enter both username and password.');
      return;
    }
    authBtn.disabled = true;
    authBtn.textContent = 'Connecting to server...';
    renderLoginError(''); 
    const authType = isLoginMode ? 'login' : 'signup';
    connect(username, password, authType); 
  });
}

// ✅ SAFE Group Modal Listeners
const newGroupBtn = document.getElementById('new-group-chat-btn');
if (newGroupBtn) {
  newGroupBtn.addEventListener('click', () => {
    const groupNameInput = document.getElementById('group-name-input');
    if (groupNameInput) groupNameInput.value = '';
    renderGroupModal(window.allUsers || []);
    if (el.groupModal) el.groupModal.classList.add('is-active');
  });
}

const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn) closeModalBtn.addEventListener('click', () => { if (el.groupModal) el.groupModal.classList.remove('is-active'); });

const cancelModalBtn = document.getElementById('cancel-modal-btn');
if (cancelModalBtn) cancelModalBtn.addEventListener('click', () => { if (el.groupModal) el.groupModal.classList.remove('is-active'); });

const modalBackground = document.getElementById('modal-background');
if (modalBackground) modalBackground.addEventListener('click', () => { if (el.groupModal) el.groupModal.classList.remove('is-active'); });

const leaveGroupBtn = document.getElementById('leave-group-btn');
if (leaveGroupBtn) {
  leaveGroupBtn.addEventListener('click', () => {
    const conversationId = state.activeConversationId;
    if (!conversationId || !confirm('Leave this group?')) return;
    send({ type: 'leave_group', conversationId });
  });
}

// ✅ SAFE Invite Modal Listeners
if (el.inviteModalBody) {
  el.inviteModalBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const conversationId = btn.dataset.id;
    if (btn.dataset.action === 'accept') {
      window.setRequestedGroupId(conversationId);
      send({ type: 'accept_group_invite', conversationId });
    } else {
      send({ type: 'decline_group_invite', conversationId });
    }
  });
}

const closeInviteBtn = document.getElementById('close-invite-modal-btn');
if (closeInviteBtn) closeInviteBtn.addEventListener('click', closeInviteModal);

const inviteModalBg = document.getElementById('invite-modal-background');
if (inviteModalBg) inviteModalBg.addEventListener('click', closeInviteModal);

const confirmGroupBtn = document.getElementById('confirm-group-btn');
if (confirmGroupBtn) {
  confirmGroupBtn.addEventListener('click', async () => {
    const groupNameInput = document.getElementById('group-name-input');
    const groupName = groupNameInput ? groupNameInput.value.trim() : '';
    
    if (!groupName) {
      alert('Please enter a group name.');
      return;
    }

    const checkboxes = el.groupMemberList ? el.groupMemberList.querySelectorAll('input[type="checkbox"]:checked') : [];
    const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedUsers.length === 0) {
      alert('Please select at least one member.');
      return;
    }

    // Generate ONE simple AES key for the whole group
    const key = await generateKey();
    const rawKey = await exportKey(key);

    send({ type: 'create_group', name: groupName, members: selectedUsers, conversationKey: rawKey });
    if (el.groupModal) el.groupModal.classList.remove('is-active');
  });
}

// ✅ SAFE Message Form Listener
if (el.messageForm) {
  el.messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = el.messageInput ? el.messageInput.value.trim() : '';
    const conversationId = state.activeConversationId;
    if (!content || !conversationId) return;

    stopTyping();

    const key = state.conversationKeys.get(conversationId);
    if (!key) {
      alert('This conversation is not decryptable on this device.');
      return;
    }
    const payloadContent = await encryptText(content, key);
    send({ type: 'send_message', conversationId, content: payloadContent });
    if (el.messageInput) el.messageInput.value = '';
  });
}