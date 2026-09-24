export const state = {
  username: null,
  onlineUsers: new Set(),
  conversations: new Map(),
  activeConversationId: null,
  unreadCounts: new Map(),
  conversationKeys: new Map(),
  identityPrivateKey: null,
  identityPublicKey: null,
  publicKeys: new Map(),
  typingUsers: new Map(),
  pendingInvites: new Map()
};

export function addOrUpdateConversation(conversationId, { members, messages, lastMessageAt, isGroup, name }) {
  const existing = state.conversations.get(conversationId) || { members: [], messages: [], lastMessageAt: null, isGroup: false, name: null };
  state.conversations.set(conversationId, {
    members: members !== undefined ? members : existing.members,
    messages: messages !== undefined ? messages : existing.messages,
    lastMessageAt: lastMessageAt !== undefined ? lastMessageAt : existing.lastMessageAt,
    isGroup: isGroup !== undefined ? isGroup : existing.isGroup,
    name: name !== undefined ? name : existing.name,
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

export function setTyping(conversationId, username, isTyping) {
  let set = state.typingUsers.get(conversationId);
  if (!set) {
    set = new Set();
    state.typingUsers.set(conversationId, set);
  }
  if (isTyping) set.add(username);
  else set.delete(username);
}

export function addInvite(invite) {
  state.pendingInvites.set(invite.conversationId, invite);
}

export function removeInvite(conversationId) {
  state.pendingInvites.delete(conversationId);
}
