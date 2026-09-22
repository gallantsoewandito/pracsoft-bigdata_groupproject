import { state, removeConversation } from './state.js';
import { el, renderLoginError, renderAll, renderGroupModal } from './ui.js';
import { connect, send, setActiveConversation, setRequestedTarget } from './network.js';
import { generateKey, exportKey, encryptText } from './crypto.js';

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

function stopTyping() {
  const conversationId = state.activeConversationId;
  clearTimeout(typingTimeout);
  if (isCurrentlyTyping && conversationId) {
    isCurrentlyTyping = false;
    send({ type: 'typing', conversationId, isTyping: false });
  }
}

el.messageInput.addEventListener('input', () => {
  const conversationId = state.activeConversationId;
  if (!conversationId) return;

  if (!isCurrentlyTyping) {
    isCurrentlyTyping = true;
    send({ type: 'typing', conversationId, isTyping: true });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000); // stop after 2s of inactivity
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

// ✅ CREATE GROUP & CLOSE MODAL
document.getElementById('confirm-group-btn').addEventListener('click', () => {
  const checkboxes = el.groupMemberList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
  
  if (selectedUsers.length === 0) {
    alert('Please select at least one member.');
    return;
  }

  send({ type: 'create_group', members: selectedUsers });
  el.groupModal.classList.remove('is-active');
});

el.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId) return;

  stopTyping(); // sending a message means you're done typing

  const key = state.conversationKeys.get(conversationId);
  let payloadContent = content;
  if (key) {
    payloadContent = await encryptText(content, key);
  }

  send({ type: 'send_message', conversationId, content: payloadContent });
  el.messageInput.value = '';
});