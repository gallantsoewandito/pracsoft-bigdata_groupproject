import { state, addOrUpdateConversation, appendMessage, removeConversation } from './state.js';
import { renderLoginError, renderLoggedIn, renderOnlineUsers, renderActiveConversation, renderAll } from './ui.js';

let ws = null;

export function connect(username) {
  ws = new WebSocket(`ws://${window.location.host}`);

  ws.addEventListener('open', () => {
    send({ type: 'register', username });
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
  }
}

export function handleServerMessage(data) {
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
      console.log('📩 Received from server:', data.type, 'Convo ID:', data.conversationId, 'Members:', data.members);
      addOrUpdateConversation(data.conversationId, {
        members: data.members,
        messages: data.history || [],
      });
      setActiveConversation(data.conversationId);
      break;

    case 'member_update':
      addOrUpdateConversation(data.conversationId, { members: data.members });
      renderActiveConversation();
      renderOnlineUsers(window.allUsers || [], state.onlineUsers);
      break;

    case 'new_message':
      appendMessage(data.conversationId, data);
      if (data.conversationId === state.activeConversationId) {
        renderActiveConversation();
      }
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