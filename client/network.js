import { generateKey, generateIdentityKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey, unwrapConversationKey, wrapConversationKey, decryptText } from './crypto.js';
import { state, addOrUpdateConversation, appendMessage, removeConversation, setTyping } from './state.js';
import { renderLoginError, renderLoggedIn, renderOnlineUsers, renderActiveConversation, renderAll, renderTypingIndicator } from './ui.js';

let ws = null;
let requestedTarget = null;
let isConnecting = false;
let heartbeatInterval = null;

async function initializeIdentity() {
  const storageKey = `messaging-private-key-${state.username}`;
  const publicStorageKey = `messaging-public-key-${state.username}`;
  const storedPrivateKey = localStorage.getItem(storageKey);
  const storedPublicKey = localStorage.getItem(publicStorageKey);
  if (storedPrivateKey && storedPublicKey) {
    state.identityPrivateKey = await importPrivateKey(storedPrivateKey);
    state.identityPublicKey = await importPublicKey(storedPublicKey);
  } else {
    const pair = await generateIdentityKeyPair();
    state.identityPrivateKey = pair.privateKey;
    state.identityPublicKey = pair.publicKey;
    localStorage.setItem(storageKey, await exportPrivateKey(pair.privateKey));
    localStorage.setItem(publicStorageKey, await exportPublicKey(pair.publicKey));
  }
  send({ type: 'register_public_key', publicKey: await exportPublicKey(state.identityPublicKey) });
}

export function setRequestedTarget(user) {
  requestedTarget = user;
}

export function connect(username, password, authType) {
  if (isConnecting) {
    console.warn('Connection already in progress. Please wait.');
    return;
  }
  isConnecting = true;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    || window.location.protocol === 'file:';
  const wsUrl = isLocal
    ? 'ws://localhost:3000'
    : 'wss://pracsoft-bigdata-groupproject.onrender.com';
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    isConnecting = false;
    heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000)

    send({ type: authType, username, password });
  });

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'pong') {
      return;
    }
    handleServerMessage(data);
  });

  ws.addEventListener('close', () => {
    isConnecting = false;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
    }
    renderLoginError('Disconnected from server.');
    document.getElementById('app').classList.add('is-hidden');
    document.getElementById('login-screen').classList.remove('is-hidden');
  });

  ws.addEventListener('error', () => {
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
      break;

    case 'full_user_list':
      if (data.users) {
        window.allUsers = data.users;
      }
      renderOnlineUsers(window.allUsers || [], state.onlineUsers);
      for (const username of window.allUsers || []) {
        if (username !== state.username) send({ type: 'get_public_key', username });
      }
      break;

    case 'public_key':
      state.publicKeys.set(data.username, await importPublicKey(data.publicKey));
      if (data.username === state.username) break;
      const conversationKey = await generateKey();
      const conversationKeys = {
        [state.username]: await wrapConversationKey(conversationKey, state.identityPublicKey),
        [data.username]: await wrapConversationKey(conversationKey, state.publicKeys.get(data.username))
      };
      window.send({ type: 'start_dm', targetUsername: data.username, conversationKeys });
      break;

    case 'my_conversations':
      for (const conversationId of data.conversationIds) {
        send({ type: 'join_conversation', conversationId });
      }
      break;

    case 'conversation_created':
    case 'conversation_joined':
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
      decryptedHistory = await Promise.all(data.history.map(async (msg) => {
      msg.content = await decryptText(msg.content, key);
      return msg;
  }));
}

      const lastMsg = decryptedHistory.length > 0 
        ? decryptedHistory[decryptedHistory.length - 1].created_at 
        : (data.createdAt || null);

      addOrUpdateConversation(data.conversationId, {
        members: data.members,
        messages: decryptedHistory,
        lastMessageAt: lastMsg,
        isGroup: data.isGroup
      });
      
      if (requestedTarget && data.members.includes(requestedTarget)) {
        setActiveConversation(data.conversationId);
        requestedTarget = null;
      } else if (data.type === 'conversation_created') {
        setActiveConversation(data.conversationId);
      }
      break;

    case 'group_invite': {
      const shouldJoin = window.confirm(`${data.inviter} invited you to join a group. Accept invitation?`);
      if (shouldJoin) {
        send({ type: 'accept_group_invite', conversationId: data.conversationId });
      }
      break;
    }

    case 'group_left':
      state.conversationKeys.delete(data.conversationId);
      removeConversation(data.conversationId);
      renderAll();
      break;

    case 'typing':
      setTyping(data.conversationId, data.username, data.isTyping);
      if (data.conversationId === state.activeConversationId) {
      renderTypingIndicator();
      }
      break;

    case 'new_message':
      const msgKey = state.conversationKeys.get(data.conversationId);
      let displayContent = data.content;
      
      if (msgKey) {
        displayContent = await decryptText(data.content, msgKey);
      }

      const decryptedMsg = { ...data, content: displayContent };
      appendMessage(data.conversationId, decryptedMsg);

      setTyping(data.conversationId, data.senderId, false);
      if (data.conversationId === state.activeConversationId) {
      renderTypingIndicator();
}
      
      const convo = state.conversations.get(data.conversationId);
      if (convo) convo.lastMessageAt = data.createdAt;

      if (data.conversationId === state.activeConversationId) {
        renderActiveConversation();
      }

      break;

    case 'member_update':
      addOrUpdateConversation(data.conversationId, { members: data.members });
      renderActiveConversation();
      break;

    default:
      console.warn('Unhandled message type from server:', data.type);
  }
}

export function setActiveConversation(conversationId) {
  state.activeConversationId = conversationId;
  renderActiveConversation();
  renderOnlineUsers(window.allUsers || [], state.onlineUsers);
}