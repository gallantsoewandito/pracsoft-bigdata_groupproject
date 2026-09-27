import { state, removeConversation } from './state.js';
import {
  el,
  renderLoginError,
  renderAll,
  renderGroupModal,
  closeInviteModal,
  setSidebarSearchQuery,
  setMessageSearchQuery,
  moveMessageSearch,
  clearMessageSearch
} from './ui.js';
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

const ATTACHMENT_PREFIX = '[[ATTACHMENT_V1]]';
const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;
const attachmentInput = document.getElementById('attachment-input');
const attachFileBtn = document.getElementById('attach-file-btn');
const uploadStatus = document.getElementById('upload-status');

function setUploadStatus(text, isError = false) {
  if (!uploadStatus) return;
  uploadStatus.textContent = text || '';
  uploadStatus.classList.toggle('is-error', Boolean(isError));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadAttachment(file) {
  const conversationId = state.activeConversationId;
  if (!conversationId) throw new Error('Open a conversation before attaching a file.');
  if (!state.username) throw new Error('You must be logged in.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than the 75 MB limit.`);

  const key = state.conversationKeys.get(conversationId);
  if (!key) throw new Error('This conversation is not decryptable on this device.');

  const params = new URLSearchParams({
    name: file.name,
    type: file.type || 'application/octet-stream'
  });

  const response = await fetch(`/api/upload?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chat-Username': state.username,
      'X-Conversation-Id': conversationId
    },
    body: file
  });

  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);

  // The attachment descriptor travels through the SAME encrypted message path
  // already used for normal chat text. No key-management code is changed.
  const descriptor = ATTACHMENT_PREFIX + JSON.stringify(result);
  const encryptedDescriptor = await encryptText(descriptor, key);
  send({ type: 'send_message', conversationId, content: encryptedDescriptor });
}

if (attachFileBtn && attachmentInput) {
  attachFileBtn.addEventListener('click', () => {
    if (!state.activeConversationId) {
      alert('Open a conversation before attaching a file.');
      return;
    }
    attachmentInput.click();
  });

  attachmentInput.addEventListener('change', async () => {
    const files = Array.from(attachmentInput.files || []);
    if (!files.length) return;

    attachFileBtn.disabled = true;
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setUploadStatus(`Uploading ${file.name} (${i + 1}/${files.length})...`);
        await uploadAttachment(file);
        // Existing server anti-spam rule allows one chat message per 500 ms.
        if (i < files.length - 1) await sleep(550);
      }
      setUploadStatus(files.length === 1 ? 'Attachment sent.' : `${files.length} attachments sent.`);
      setTimeout(() => setUploadStatus(''), 2200);
    } catch (err) {
      console.error(err);
      setUploadStatus(err.message || 'Attachment upload failed.', true);
    } finally {
      attachmentInput.value = '';
      attachFileBtn.disabled = false;
    }
  });
}

// Search users, DMs, and group chats in the sidebar.
if (el.sidebarSearchInput) {
  el.sidebarSearchInput.addEventListener('input', () => {
    setSidebarSearchQuery(el.sidebarSearchInput.value);
  });

  el.sidebarSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      el.sidebarSearchInput.value = '';
      setSidebarSearchQuery('');
      el.sidebarSearchInput.blur();
    }
  });
}

// Search the already-loaded, decrypted messages in the active conversation.
if (el.messageSearchInput) {
  el.messageSearchInput.addEventListener('input', () => {
    setMessageSearchQuery(el.messageSearchInput.value);
  });

  el.messageSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveMessageSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      clearMessageSearch();
      el.messageSearchInput.blur();
    }
  });
}

if (el.messageSearchPrev) {
  el.messageSearchPrev.addEventListener('click', () => moveMessageSearch(-1));
}

if (el.messageSearchNext) {
  el.messageSearchNext.addEventListener('click', () => moveMessageSearch(1));
}

if (el.messageSearchClear) {
  el.messageSearchClear.addEventListener('click', clearMessageSearch);
}

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