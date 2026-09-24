import { generateKey, generateIdentityKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey, unwrapConversationKey, wrapConversationKey, decryptText } from './crypto.js';
import { state, addOrUpdateConversation, appendMessage, removeConversation, setTyping, addInvite, removeInvite, incrementUnread, clearUnread } from './state.js';
import { renderLoginError, renderLoggedIn, renderOnlineUsers, renderActiveConversation, renderAll, renderTypingIndicator, renderInvites, renderConversationList } from './ui.js';

let ws = null;
let requestedTarget = null;
let requestedGroupId = null;
let isConnecting = false;
let heartbeatInterval = null;
let messageQueue = Promise.resolve();

async function safeDecrypt(content, key) {
  try {
    return await decryptText(content, key);
  } catch (err) {
    console.warn('Failed to decrypt message, keeping raw content:', err);
    return content;
  }
}

async function createIdentity() {
  const storageKey = `messaging-private-key-${state.username}`;
  const publicStorageKey = `messaging-public-key-${state.username}`;
  const pair = await generateIdentityKeyPair();
  state.identityPrivateKey = pair.privateKey;
  state.identityPublicKey = pair.publicKey;
  localStorage.setItem(storageKey, await exportPrivateKey(pair.privateKey));
  localStorage.setItem(publicStorageKey, await exportPublicKey(pair.publicKey));
}

async function initializeIdentity() {
  const storageKey = `messaging-private-key-${state.username}`;
  const publicStorageKey = `messaging-public-key-${state.username}`;
  const storedPrivateKey = localStorage.getItem(storageKey);
  const storedPublicKey = localStorage.getItem(publicStorageKey);
  if (storedPrivateKey && storedPublicKey) {
    try {
      state.identityPrivateKey = await importPrivateKey(storedPrivateKey);
      state.identityPublicKey = await importPublicKey(storedPublicKey);
    } catch (err) {
      console.warn('Stored identity keys invalid, generating new ones:', err);
      await createIdentity();
    }
  } else {
    await createIdentity();
  }
  send({ type: 'register_public_key', publicKey: await exportPublicKey(state.identityPublicKey) });
}

export function setRequestedTarget(user) {
  requestedTarget = user;
}

export function setRequestedGroupId(conversationId) {
  requestedGroupId = conversationId;
}

function findDm(user) {
  for (const [id, c] of state.conversations) {
    if (!c.isGroup && c.members.includes(user)) return id;
  }
  return null;
}

export function connect(username, password, authType) {
  if (isConnecting) {
    console.warn('Connection already in progress. Please wait.');
    return;
  }
  isConnecting = true;

  clearInterval(heartbeatInterval);
  if (ws) {
    const old = ws;
    ws = null;
    old.close();
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    || window.location.protocol === 'file:';
  const wsUrl = isLocal
    ? 'ws://localhost:3000'
    : 'wss://pracsoft-bigdata-groupproject.onrender.com';
  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.addEventListener('open', () => {
    if (socket !== ws) return;
    isConnecting = false;
    heartbeatInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    send({ type: authType, username, password });
  });

  socket.addEventListener('message', (event) => {
    if (socket !== ws) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      console.warn('Ignoring malformed server message:', err);
      return;
    }

    if (data.type === 'pong') return;

    messageQueue = messageQueue
      .then(() => handleServerMessage(data))
      .catch(err => { console.error('Handler failed:', err); renderLoginError('Error: ' + err.message); });
  });

  socket.addEventListener('close', () => {
    if (socket !== ws) return;
    isConnecting = false;
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    requestedTarget = null;
    requestedGroupId = null;
    state.onlineUsers = new Set();
    state.typingUsers.clear();
    state.username = null;
    state.activeConversationId = null;
    state.conversations.clear();
    state.conversationKeys.clear();
    state.publicKeys.clear();
    state.pendingInvites.clear();
    state.unreadCounts.clear();
    renderLoginError('Disconnected from server.');
    document.getElementById('app').classList.add('is-hidden');
    document.getElementById('login-screen').classList.remove('is-hidden');
  });

  socket.addEventListener('error', () => {
    if (socket !== ws) return;
    isConnecting = false;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    renderLoginError('Connection error.');
  });
}

export function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.warn('Cannot send, WebSocket is not open.');
  }
}

export async function handleServerMessage(data) {
  switch (data.type) {
    case 'registered':
      state.username = data.username;
      await initializeIdentity();
      renderLoggedIn();
      renderAll();
      send({ type: 'get_pending_invites' });
      break;

    case 'error':
      if (!state.username) {
        renderLoginError(data.message);
      } else {
        alert(data.message);
      }
      break;

    case 'user_list':
      if (data.users) {
        state.onlineUsers = new Set(data.users);
      }
      renderOnlineUsers(window.allUsers || [], state.onlineUsers);
      for (const username of state.onlineUsers) {
        if (username !== state.username && !state.publicKeys.has(username)) {
          send({ type: 'get_public_key', username });
        }
      }
      break;

    case 'full_user_list':
      if (data.users) {
        window.allUsers = data.users;
      }
      renderOnlineUsers(window.allUsers || [], state.onlineUsers);
      for (const username of state.onlineUsers) {
        if (username !== state.username && !state.publicKeys.has(username)) {
          send({ type: 'get_public_key', username });
        }
      }
      break;

    case 'public_key': {
      state.publicKeys.set(data.username, await importPublicKey(data.publicKey));
      if (data.username === state.username || requestedTarget !== data.username) break;

      const existingId = findDm(data.username);
      if (existingId) {
        requestedTarget = null;
        setActiveConversation(existingId);
        break;
      }

      const conversationKey = await generateKey();
      const conversationKeys = {
        [state.username]: await wrapConversationKey(conversationKey, state.identityPublicKey),
        [data.username]: await wrapConversationKey(conversationKey, state.publicKeys.get(data.username))
      };
      send({ type: 'start_dm', targetUsername: data.username, conversationKeys });
      break;
    }

    case 'public_key_unavailable': {
      if (requestedTarget !== data.username) break;
      const existingId = findDm(data.username);
      requestedTarget = null;
      if (existingId) setActiveConversation(existingId);
      else alert(`${data.username} must be online at least once before you can start an encrypted chat.`);
      break;
    }

    case 'my_conversations':
      for (const conversationId of data.conversationIds) {
        send({ type: 'join_conversation', conversationId });
      }
      break;

    case 'conversation_created':
    case 'conversation_joined': {
      let key = state.conversationKeys.get(data.conversationId);

      if (data.conversationKey && !key) {
        try {
          const wrappedKeys = JSON.parse(data.conversationKey);
          const wrappedKey = wrappedKeys[state.username];
          if (wrappedKey && state.identityPrivateKey) {
            key = await unwrapConversationKey(wrappedKey, state.identityPrivateKey);
            state.conversationKeys.set(data.conversationId, key);
          }
        } catch (error) {
          console.warn('Conversation uses a legacy key format and cannot be decrypted.');
        }
      }

      let decryptedHistory = [];
      if (data.history && data.history.length > 0) {
        decryptedHistory = await Promise.all(data.history.map(async (msg) => ({
          ...msg,
          content: await safeDecrypt(msg.content, key)
        })));
      }

      const lastMsg = decryptedHistory.length > 0
        ? decryptedHistory[decryptedHistory.length - 1].created_at
        : (data.createdAt || null);

      addOrUpdateConversation(data.conversationId, {
        members: data.members,
        messages: decryptedHistory,
        lastMessageAt: lastMsg,
        isGroup: data.isGroup,
        name: data.name
      });
      renderConversationList();

      if (requestedGroupId && data.conversationId === requestedGroupId) {
        setActiveConversation(data.conversationId);
        requestedGroupId = null;
      } else if (requestedTarget && !data.isGroup && data.members.includes(requestedTarget)) {
        setActiveConversation(data.conversationId);
        requestedTarget = null;
      } else if (data.type === 'conversation_created') {
        setActiveConversation(data.conversationId);
      }
      break;
    }

    case 'group_invite': {
      addInvite({ conversationId: data.conversationId, inviter: data.inviter, name: data.name, conversationKey: data.conversationKey });
      renderInvites();
      break;
    }

    case 'pending_invites':
      state.pendingInvites.clear();
      for (const invite of data.invites || []) {
        addInvite(invite);
      }
      renderInvites();
      break;

    case 'group_invite_declined':
      removeInvite(data.conversationId);
      renderInvites();
      break;

    case 'group_invite_accepted':
      removeInvite(data.conversationId);
      renderInvites();
      break;

    case 'group_left':
      state.conversationKeys.delete(data.conversationId);
      state.unreadCounts.delete(data.conversationId);
      removeConversation(data.conversationId);
      renderAll();
      break;

    case 'typing':
      setTyping(data.conversationId, data.username, data.isTyping);
      if (data.conversationId === state.activeConversationId) {
        renderTypingIndicator();
      }
      break;

    case 'new_message': {
      if (!state.conversations.has(data.conversationId)) {
        if (data.senderId !== state.username) incrementUnread(data.conversationId);
        send({ type: 'join_conversation', conversationId: data.conversationId });
        break;
      }

      const msgKey = state.conversationKeys.get(data.conversationId);
      const displayContent = msgKey ? await safeDecrypt(data.content, msgKey) : data.content;

      appendMessage(data.conversationId, { ...data, content: displayContent });

      setTyping(data.conversationId, data.senderId, false);
      if (data.conversationId === state.activeConversationId) {
        renderTypingIndicator();
      }

      const convo = state.conversations.get(data.conversationId);
      if (convo) convo.lastMessageAt = data.createdAt;

      if (data.conversationId !== state.activeConversationId && data.senderId !== state.username) {
        incrementUnread(data.conversationId);
      }

      if (data.conversationId === state.activeConversationId) {
        renderActiveConversation();
      }
      renderConversationList();
      break;
    }

    case 'member_update':
      if (!state.conversations.has(data.conversationId)) break;
      addOrUpdateConversation(data.conversationId, { members: data.members });
      renderActiveConversation();
      renderConversationList();
      break;

    default:
      console.warn('Unhandled message type from server:', data.type);
  }
}

export function setActiveConversation(conversationId) {
  state.activeConversationId = conversationId;
  clearUnread(conversationId);
  renderActiveConversation();
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
  renderConversationList();
}
