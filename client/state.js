export const state = {
  username: null,
  onlineUsers: [],
  conversations: new Map(),
  activeConversationId: null,
  unreadCounts: new Map()
};

export function addOrUpdateConversation(conversationId, { members, messages, lastMessageAt }) {
  const existing = state.conversations.get(conversationId) || { members: [], messages: [], lastMessageAt: null };
  state.conversations.set(conversationId, {
    members: members !== undefined ? members : existing.members,
    messages: messages !== undefined ? messages : existing.messages,
    lastMessageAt: lastMessageAt !== undefined ? lastMessageAt : existing.lastMessageAt,
  });
}

export function appendMessage(conversationId, message) {
  const convo = state.conversations.get(conversationId);
  if (!convo) return;
  convo.messages.push(message);
}

export function removeConversation(conversationId) {
  state.conversations.delete(conversationId);
  if (state.activeConversationId === conversationId) {
    state.activeConversationId = null;
  }
}

export function incrementUnread(conversationId) {
  if (state.activeConversationId === conversationId) return;
  const current = state.unreadCounts.get(conversationId) || 0;
  state.unreadCounts.set(conversationId, current + 1);
}

export function clearUnread(conversationId) {
  state.unreadCounts.set(conversationId, 0);
}