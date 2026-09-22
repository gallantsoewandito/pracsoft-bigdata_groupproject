import { importKey, decryptText } from './crypto.js';
import { state, addOrUpdateConversation, appendMessage, removeConversation, setTyping } from './state.js';
import { renderLoginError, renderLoggedIn, renderOnlineUsers, renderActiveConversation, renderAll, renderTypingIndicator } from './ui.js';

let ws = null;
let requestedTarget = null;

export function setRequestedTarget(user) {
  requestedTarget = user;
}

export function connect(username, password, authType) {
  const wsUrl = window.location.hostname === 'localhost' 
    ? 'ws://localhost:3000' 
    : 'wss://pracsoft-bigdata-groupproject.onrender.com';
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    send({ type: authType, username, password });
  });

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  });

  ws.addEventListener('close', () => {
    renderLoginError('Disconnected from server.');
    document.getElementById('app').classList.add('is-hidden');
    document.getElementById('login-screen').classList.remove('is-hidden');
  });

  ws.addEventListener('error', () => {
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
        key = await importKey(data.conversationKey);
        state.conversationKeys.set(data.conversationId, key);
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
        lastMessageAt: lastMsg
      });
      
      if (requestedTarget && data.members.includes(requestedTarget)) {
        setActiveConversation(data.conversationId);
        requestedTarget = null;
      } else if (data.type === 'conversation_created') {
        setActiveConversation(data.conversationId);
      }
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