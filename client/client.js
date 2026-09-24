import { state, removeConversation } from './state.js';
import { el, renderLoginError, renderAll, renderGroupModal, closeInviteModal } from './ui.js';
import { connect, send, setActiveConversation, setRequestedTarget, setRequestedGroupId } from './network.js';
import { generateKey, encryptText, wrapConversationKey } from './crypto.js';
window.setRequestedGroupId = setRequestedGroupId;

// Expose functions to the window object so other modules can use them
window.state = state;
window.send = send;
window.setActiveConversation = setActiveConversation;
window.setRequestedTarget = setRequestedTarget;

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

// Toggle between Login and Signup
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

// Handle Auth Button Click (Login or Signup)
authBtn.addEventListener('click', () => {
  const username = document.getElementById('username-input').value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    renderLoginError('Please enter both username and password.');
    return;
  }

  authBtn.disabled = true;
  authBtn.textContent = 'Connecting to server...'
  renderLoginError(''); 

  const authType = isLoginMode ? 'login' : 'signup';
  connect(username, password, authType); 
});

// ✅ OPEN MODAL
document.getElementById('new-group-chat-btn').addEventListener('click', () => {
  document.getElementById('group-name-input').value = '';
  renderGroupModal(window.allUsers || []);
  el.groupModal.classList.add('is-active');
});

// ✅ CLOSE MODAL
document.getElementById('close-modal-btn').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

document.getElementById('cancel-modal-btn').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

document.getElementById('modal-background').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

document.getElementById('leave-group-btn').addEventListener('click', () => {
  const conversationId = state.activeConversationId;
  if (!conversationId || !confirm('Leave this group?')) return;
  send({ type: 'leave_group', conversationId });
});

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

document.getElementById('close-invite-modal-btn').addEventListener('click', closeInviteModal);
document.getElementById('invite-modal-background').addEventListener('click', closeInviteModal);

document.getElementById('confirm-group-btn').addEventListener('click', async () => {
  const groupName = document.getElementById('group-name-input').value.trim();
  if (!groupName) {
    alert('Please enter a group name.');
    return;
  }

  const checkboxes = el.groupMemberList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
  
  if (selectedUsers.length === 0) {
    alert('Please select at least one member.');
    return;
  }

  const missingKeys = selectedUsers.filter(user => !state.publicKeys.has(user));
  if (missingKeys.length > 0) {
    alert('These users must be online at least once before you can add them: ' + missingKeys.join(', '));
    return;
  }
  const key = await generateKey();
  const conversationKeys = {
    [state.username]: await wrapConversationKey(key, state.identityPublicKey)
  };
  for (const username of selectedUsers) {
    conversationKeys[username] = await wrapConversationKey(key, state.publicKeys.get(username));
  }
  send({ type: 'create_group', name: groupName, members: selectedUsers, conversationKeys });
  el.groupModal.classList.remove('is-active');
});

el.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId) return;

  stopTyping(); // sending a message means you're done typing

  const key = state.conversationKeys.get(conversationId);
  if (!key) {
    alert('This conversation is not decryptable on this device, so you cannot send messages in it.');
    return;
  }
  const payloadContent = await encryptText(content, key);

  send({ type: 'send_message', conversationId, content: payloadContent });
  el.messageInput.value = '';
});
