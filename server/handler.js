const supabase = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto')

const clients = new Map();
const conversations = new Map();
const conversationKeys = new Map();
const groupInvites = new Map();
const groupConversations = new Set();

const MAX_CONTENT_LENGTH = 2200;

async function handlePing(ws) {
  send(ws, { type: 'pong' });
}

function send(ws, payload) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
    }
}

function sendError(ws, message) {
    send(ws, { type: 'error', message });
}

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const payload = JSON.stringify({ type: 'user_list', users });
    for (const clientData of clients.values()) {
        if (clientData && clientData.ws && clientData.ws.readyState === 1) {
            clientData.ws.send(payload);
        }
    }
}

function broadcastMemberUpdate(conversationId) {
    const members = Array.from(conversations.get(conversationId) || []);
    const payload = { type: 'member_update', conversationId, members };
    for (const username of members) {
        const client = clients.get(username);
        if (client && client.ws && client.ws.readyState === 1) {
            send(client.ws, payload);
        }
    }
}

function requireRegistered(ws) {
    if (!ws.username) {
        sendError(ws, 'You must register a username before doing that.');
        return false;
    }
    return true;
}

async function handleSignup(ws, data) {
    const username = (data.username || '').trim();
    const password = data.password;

    if (!username || !password) {
        sendError(ws, 'Username and password are required.');
        return;
    }

    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) {
        sendError(ws, 'Username must be 3-20 characters: letters, numbers, underscore, dot or hyphen.');
        return;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    
    if (!passwordRegex.test(password)) {
        sendError(ws, 'Password must be at least 8 characters long, contain at least one uppercase letter, and at least one number.');
        return;
    }

    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .single();

    if (existingUser) {
        sendError(ws, 'Username is already taken.');
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ username: username, password_hash: hashedPassword }])
        .select('id, username')
        .single();

    if (insertError) {
        console.error('Signup error:', insertError);
        sendError(ws, 'Failed to create account.');
        return;
    }

    ws.username = newUser.username;
    clients.set(newUser.username, { ws: ws, id: newUser.id, lastMessageTime: 0 });

    const sessionToken = data.sessionToken || crypto.randomUUID();
    await supabase.from('users').update({ session_token: sessionToken }).eq('id', newUser.id);

    send(ws, { type: 'registered', username: newUser.username, sessionToken });
    await loadInitialData(ws, newUser.id);
}

async function handleLogin(ws, data) {
    const username = (data.username || '').trim();
    const password = data.password;

    if (!username || !password) {
        sendError(ws, 'Username and password are required.');
        return;
    }

    const { data: user, error} = await supabase
        .from('users')
        .select('id, username, password_hash')
        .eq('username', username)
        .single();

    if (error || !user) {
        sendError(ws, 'Invalid username or password.');
        return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
        sendError(ws, 'Invalid username or password.');
        return;
    }

    if (clients.has(user.username)) {
        const oldClient = clients.get(user.username);
        send(oldClient.ws, { type: 'error', message: 'You have been logged in from another device.' });
        oldClient.ws.username = null;
        oldClient.ws.close();
        clients.delete(user.username);
    }

    ws.username = user.username;
    clients.set(user.username, { ws: ws, id: user.id, lastMessageTime: 0 });

    const sessionToken = data.sessionToken || crypto.randomUUID();
    await supabase.from('users').update({ session_token: sessionToken }).eq('id', user.id);

    send(ws, { type: 'registered', username: user.username, sessionToken });
    await loadInitialData(ws, user.id);
}

async function loadInitialData(ws, userId) {
    const { data: memberships } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId);

    if (memberships && memberships.length > 0) {
        const conversationIds = memberships.map(m => m.conversation_id);
        send(ws, { type: 'my_conversations', conversationIds });
    }

    const { data: allUsersData } = await supabase.from('users').select('username');
    if (allUsersData) {
        send(ws, { type: 'full_user_list', users: allUsersData.map(u => u.username) });
    }

    broadcastUserList();
}

async function handleCreateConversation(ws) {
    if (!requireRegistered(ws)) return;

    const clientData = clients.get(ws.username);

    if (!clientData) return;

    const { data: row, error } = await supabase
        .from('conversations')
        .insert([{}])
        .select()
        .single();

    if (error) {
        console.error('Supabase error creating conversation:', error);
        sendError(ws, 'Failed to create conversation.');
        return;
    }

    const conversationId = row.id;

    await supabase
        .from('conversation_members')
        .insert([{ conversation_id: conversationId, user_id: clientData.id }]);
    conversations.set(conversationId, new Set([ws.username]));
    send(ws, { type: 'conversation_created', conversationId });
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;

async function getMembersWithReceipts(conversationId) {
    const { data: rows } = await supabase
        .from('conversation_members')
        .select('user_id, delivered_at, read_at')
        .eq('conversation_id', conversationId);

    const result = { members: [], receipts: {} };
    if (!rows || rows.length === 0) return result;

    const { data: users } = await supabase
        .from('users')
        .select('id, username')
        .in('id', rows.map(r => r.user_id));

    const nameById = new Map((users || []).map(u => [u.id, u.username]));
    for (const row of rows) {
        const name = nameById.get(row.user_id);
        if (!name) continue;
        result.members.push(name);
        result.receipts[name] = { deliveredAt: row.delivered_at, readAt: row.read_at };
    }
    return result;
}

async function handleReceipt(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId, kind, upTo } = data;

    if (kind !== 'delivered' && kind !== 'read') return;
    if (typeof upTo !== 'string' || !ISO_TS.test(upTo)) return;

    const upToMs = Date.parse(upTo);
    if (!Number.isFinite(upToMs) || upToMs > Date.now() + 60000) return;

    const members = conversations.get(conversationId);
    if (!members || !members.has(ws.username)) return;

    const clientData = clients.get(ws.username);
    if (!clientData) return;

    const { data: row } = await supabase
        .from('conversation_members')
        .select('delivered_at, read_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', clientData.id)
        .maybeSingle();
    if (!row) return;

    const isNewer = current => !current || Date.parse(current) < upToMs;
    const patch = {};
    if (isNewer(row.delivered_at)) patch.delivered_at = upTo;
    if (kind === 'read' && isNewer(row.read_at)) patch.read_at = upTo;
    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase
        .from('conversation_members')
        .update(patch)
        .eq('conversation_id', conversationId)
        .eq('user_id', clientData.id);
    if (error) {
        console.error('Receipt update error:', error);
        return;
    }

    const payload = {
        type: 'receipt_update',
        conversationId,
        username: ws.username,
        deliveredAt: patch.delivered_at || row.delivered_at,
        readAt: patch.read_at || row.read_at
    };
    for (const username of members) {
        if (username === ws.username) continue;
        const client = clients.get(username);
        if (client && client.ws && client.ws.readyState === 1) send(client.ws, payload);
    }
}

async function handleJoinConversation(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId } = data;
    
    if (!conversationId) {
        sendError(ws, 'join_conversation requires a conversationId.');
        return;
    }

    const clientData = clients.get(ws.username);
    if (!clientData) return;

    const { data: membership, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', clientData.id)
        .maybeSingle();

    if (membershipError || !membership) {
        sendError(ws, 'You are not a member of that conversation.');
        return;
    }

    if (!conversations.has(conversationId)) {
        conversations.set(conversationId, new Set());
    }

    await supabase
        .from('conversation_members')
        .upsert(
            [{ conversation_id: conversationId, user_id: clientData.id }],
            { onConflict: 'conversation_id, user_id' }
        );

    conversations.get(conversationId).add(ws.username);

    const { data: history, error } = await supabase
        .from('messages')
        .select('id, content, created_at, sender_id')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Supabase error fetching history:', error);
        sendError(ws, 'Failed to load conversation history.');
        return;
    }

    // 2. Collect all unique sender IDs
    const senderIds = [...new Set((history || []).map(m => m.sender_id))];
    
    // 3. Fetch usernames for those IDs
    let userMap = new Map();
    if (senderIds.length > 0) {
        const { data: users } = await supabase
            .from('users')
            .select('id, username')
            .in('id', senderIds);
            
        if (users) {
            userMap = new Map(users.map(u => [u.id, u.username]));
        }
    }

    // 4. Map messages with correct usernames
    const formattedHistory = (history || []).map(msg => ({
        senderId: userMap.get(msg.sender_id) || 'Unknown',
        content: msg.content,
        created_at: msg.created_at
    }));

    const { data: convoData } = await supabase
        .from('conversations')
        .select('conversation_key, name')
        .eq('id', conversationId)
        .single();

    const { members: allMembers, receipts } = await getMembersWithReceipts(conversationId);

    send(ws, {
        type: 'conversation_joined',
        conversationId,
        members: allMembers,
        receipts,
        isGroup: groupConversations.has(conversationId) || !!(convoData && convoData.name),
        name: convoData ? convoData.name : null,
        history: formattedHistory,
        conversationKey: convoData ? convoData.conversation_key : null
    });

    broadcastMemberUpdate(conversationId);
}

async function handleAcceptGroupInvite(ws, data) {
    if (!requireRegistered(ws)) return;
    const invite = (groupInvites.get(ws.username) || []).find(item => item.conversationId === data.conversationId);
    if (!invite) {
        sendError(ws, 'That group invitation is no longer available.');
        return;
    }

    const clientData = clients.get(ws.username);
    const { error } = await supabase
        .from('conversation_members')
        .upsert(
            [{ conversation_id: invite.conversationId, user_id: clientData.id }],
            { onConflict: 'conversation_id, user_id' }
        );
    if (error) {
        sendError(ws, 'Failed to join group.');
        return;
    }

    groupInvites.set(ws.username, (groupInvites.get(ws.username) || [])
        .filter(item => item.conversationId !== invite.conversationId));
    send(ws, { type: 'group_invite_accepted', conversationId: invite.conversationId });
    await handleJoinConversation(ws, { conversationId: invite.conversationId });
    broadcastMemberUpdate(invite.conversationId);
}

function handleGetPendingInvites(ws) {
    if (!requireRegistered(ws)) return;
    const invites = groupInvites.get(ws.username) || [];
    send(ws, { type: 'pending_invites', invites });
}

function handleDeclineGroupInvite(ws, data) {
    if (!requireRegistered(ws)) return;
    const invites = groupInvites.get(ws.username) || [];
    const remaining = invites.filter(item => item.conversationId !== data.conversationId);
    groupInvites.set(ws.username, remaining);
    send(ws, { type: 'group_invite_declined', conversationId: data.conversationId });
}

async function handleLeaveGroup(ws, data) {
    if (!requireRegistered(ws)) return;
    const clientData = clients.get(ws.username);
    const { data: memberRows, error: lookupError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('conversation_id', data.conversationId)
        .eq('user_id', clientData.id)
        .maybeSingle();
    if (lookupError || !memberRows) {
        sendError(ws, 'You are not a member of that group.');
        return;
    }

    const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', data.conversationId)
        .eq('user_id', clientData.id);
    if (error) {
        sendError(ws, 'Failed to leave group.');
        return;
    }

    const members = conversations.get(data.conversationId);
    if (members) members.delete(ws.username);
    send(ws, { type: 'group_left', conversationId: data.conversationId });
    broadcastMemberUpdate(data.conversationId);
}

async function handleSendMessage(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId, content } = data;

    const clientData = clients.get(ws.username);
    if (!clientData) {
        sendError(ws, 'Session expired. Please log in again.');
        return;
    }

    const now = Date.now();

    if (now - clientData.lastMessageTime < 500) {
        sendError(ws, 'You are sending messages too quickly. Please slow down.');
        return;
    }

    clientData.lastMessageTime = now;

    // Input validation
    if (!conversationId || !content) {
        sendError(ws, 'send_message requires conversationId and content.');
        return;
    }
    if (typeof content !== 'string') {
        sendError(ws, 'Invalid message format.');
        return;
    }
    const cleanMessage = content.trim();
    if (cleanMessage.length === 0) {
        sendError(ws, 'Message cannot be empty.');
        return;
    }
    if (cleanMessage.length > MAX_CONTENT_LENGTH) {
        sendError(ws, 'Message is too long.');
        return;
    }

    const members = conversations.get(conversationId);
    if (!members || !members.has(ws.username)) {
        sendError(ws, 'You are not a member of that conversation.');
        return;
    }

    const senderData = clients.get(ws.username);

    const { data: saved, error } = await supabase
        .from('messages')
        .insert([
            {
                conversation_id: conversationId,
                sender_id: senderData.id, 
                content: cleanMessage,
            },
        ])
        .select()
        .single();

    if (error || !saved) {
        console.error('Supabase error saving message:', error);
        sendError(ws, 'Failed to save message.');
        return;
    }

    const payload = {
        type: 'new_message',
        conversationId,
        senderId: ws.username,
        content: cleanMessage,
        createdAt: saved.created_at,
    };
    
    for (const username of members) {
        const client = clients.get(username);
        if (client && client.ws && client.ws.readyState === 1) {
            send(client.ws, payload);
        }
    }
}

function handleTyping(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId, isTyping } = data;

    const members = conversations.get(conversationId);
    if (!members || !members.has(ws.username)) return;

    const payload = { type: 'typing', conversationId, username: ws.username, isTyping: !!isTyping };

    for (const username of members) {
        if (username === ws.username) continue;
        const client = clients.get(username);
        if (client && client.ws && client.ws.readyState === 1) {
            send(client.ws, payload);
        }
    }
}

async function handleStartDM(ws, data) {
    if (!requireRegistered(ws)) return;
    const { targetUsername } = data;
    
    if (!targetUsername || targetUsername === ws.username) {
        sendError(ws, 'Invalid target user.');
        return;
    }

    const currentUserData = clients.get(ws.username);
    if (!currentUserData) return;

    const { data: targetUserData, error: targetError } = await supabase
        .from('users')
        .select('id')
        .eq('username', targetUsername)
        .single();

    if (targetError || !targetUserData) {
        sendError(ws, 'User not found in database.');
        return;
    }

    const currentUserId = currentUserData.id;
    const targetUserId = targetUserData.id;

    const { data: memberRows, error: memberError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .in('user_id', [currentUserId, targetUserId]);
    
    if (memberError) {
        console.error('Supabase error finding DM:', memberError);
        sendError(ws, 'Failed to find conversation.');
        return;
    }

    const convoCounts = {};
    for (const row of memberRows) {
        convoCounts[row.conversation_id] = (convoCounts[row.conversation_id] || 0) + 1;
    }

    let existingConversationId = null;
    for (const [convoId, count] of Object.entries(convoCounts)) {
        if (count === 2) {
            const { count: totalMembers, error: countError } = await supabase
                .from('conversation_members')
                .select('*', { count: 'exact', head: true })
                .eq('conversation_id', convoId);
            
            if (!countError && totalMembers ===2) {
                existingConversationId = convoId;
                break;
            }
        }
    }

    if (existingConversationId) {
        conversations.set(existingConversationId, new Set([ws.username, targetUsername]));
        const { data: history } = await supabase
            .from('messages')
            .select(`content, created_at, sender_id`)
            .eq('conversation_id', existingConversationId)
            .order('created_at', { ascending: true });

        const senderIds = [...new Set((history || []).map(m => m.sender_id))];
        let userMap = new Map();

        if (senderIds.length > 0) {
            const { data: users } = await supabase
                .from('users')
                .select('id, username')
                .in('id', senderIds);
                
            if (users) {
                userMap = new Map(users.map(u => [u.id, u.username]));
            }
        }
            
        const formattedHistory = (history || []).map(msg => ({
            senderId: userMap.get(msg.sender_id) || 'Unknown',
            content: msg.content,
            created_at: msg.created_at
        }));
        const { data: convoData } = await supabase
            .from('conversations')
            .select('conversation_key')
            .eq('id', existingConversationId)
            .single();
        const { members: allMembers, receipts } = await getMembersWithReceipts(existingConversationId);
        send(ws, {
            type: 'conversation_joined', 
            conversationId: existingConversationId,
            members: allMembers,
            receipts,
            history: formattedHistory,
            conversationKey: convoData ? convoData.conversation_key : null
        });
        broadcastMemberUpdate(existingConversationId);
    } else {
    const { data: newRow, error: createError } = await supabase
        .from('conversations')
        .insert([{ 
            conversation_key: data.conversationKey,
            created_by: currentUserData.id
         }])
        .select()
        .single();

    if (createError || !newRow) {
        console.error('Supabase error creating DM:', createError);
        sendError(ws, 'Failed to create conversation.');
        return;
    }

    const newConvoId = newRow.id;

    await supabase
        .from('conversation_members')
        .insert([
            { conversation_id: newConvoId, user_id: currentUserId },
            { conversation_id: newConvoId, user_id: targetUserId }
        ]);

    conversations.set(newConvoId, new Set([ws.username, targetUsername]));
    conversationKeys.set(newConvoId, data.conversationKey);

    send(ws, {
        type: 'conversation_joined',
        conversationId: newConvoId,
        members: [ws.username, targetUsername],
        history: [],
        conversationKey: data.conversationKey
    });

    broadcastMemberUpdate(newConvoId);
}
}

async function handleCreateGroup(ws, data) {
    if (!requireRegistered(ws)) return;
        const { members: targetUsernames, name } = data;

    if (!Array.isArray(targetUsernames) || targetUsernames.length === 0) {
        sendError(ws, 'Invalid group members.');
        return;
    }

    const currentUserData = clients.get(ws.username);
    if (!currentUserData) return;
    
    const uniqueTargets = [...new Set(targetUsernames)].filter(username => username !== ws.username);
    if (uniqueTargets.length === 0) {
        sendError(ws, 'A group must include at least one other member.');
        return;
    }

    const { data: targetUsers, error: targetError } = await supabase
        .from('users')
        .select('id, username')
        .in('username', uniqueTargets);

    if (targetError || !targetUsers || targetUsers.length !== uniqueTargets.length) {
        sendError(ws, 'Failed to find users.');
        return;
    }

    const { data: newRow, error: createError } = await supabase
        .from('conversations')
        .insert([{ 
            conversation_key: data.conversationKey, 
            name: name || 'Group Chat',
            created_by: currentUserData.id 
        }])
        .select()
        .single();
    
    if (createError) {
        console.error('Supabase error creating group:', createError);
        sendError(ws, 'Failed to create group.');
        return;
    }

    const newConvoId = newRow.id;
    await supabase
        .from('conversation_members')
        .insert([{ conversation_id: newConvoId, user_id: currentUserData.id }]);

    conversations.set(newConvoId, new Set([ws.username]));
    groupConversations.add(newConvoId);
    conversationKeys.set(newConvoId, data.conversationKey);

    for (const user of targetUsers) {
        const invite = {
            conversationId: newConvoId,
            inviter: ws.username,
            name: name || 'Group Chat',
            conversationKey: data.conversationKey 
        };
        const invites = groupInvites.get(user.username) || [];
        invites.push(invite);
        groupInvites.set(user.username, invites);
        const targetClient = clients.get(user.username);
        if (targetClient) send(targetClient.ws, { type: 'group_invite', ...invite });
    }
    
    send(ws, { 
        type: 'conversation_created', 
        conversationId: newConvoId,
        members: [ws.username],
        isGroup: true,
        name: name || 'Group Chat',
        conversationKey: data.conversationKey,
        history: [] 
    });

    broadcastMemberUpdate(newConvoId);
}

async function handleResumeSession(ws, data) {
    const { username, sessionToken } = data;
    const { data: user, error } = await supabase
        .from('users')
        .select('id, username, session_token')
        .eq('username', username)
        .single();

    if (error || !user || user.session_token !== sessionToken) {
        sendError(ws, 'Invalid or expired session. Please log in again.');
        return;
    }

    if (clients.has(user.username)) {
        const oldClient = clients.get(user.username);
        send(oldClient.ws, { type: 'error', message: 'You have been logged in from another device.' });
        oldClient.ws.username = null;
        oldClient.ws.close();
        clients.delete(user.username);
    }

    ws.username = user.username;
    clients.set(user.username, { ws: ws, id: user.id, lastMessageTime: 0 });
    send(ws, { type: 'registered', username: user.username, sessionToken });
    await loadInitialData(ws, user.id);
}

async function handleDeleteAccount(ws, data) {
    if (!requireRegistered(ws)) return;
    const clientData = clients.get(ws.username);
    if (!clientData) return;

    const userId = clientData.id;
    const usernameToDelete = ws.username;

    // 1. Delete messages
    await supabase.from('messages').delete().eq('sender_id', userId);
    // 2. Delete conversation memberships
    await supabase.from('conversation_members').delete().eq('user_id', userId);
    // 3. Delete the user
    const { error } = await supabase.from('users').delete().eq('id', userId);

    if (error) {
        console.error('Delete account error:', error);
        sendError(ws, 'Failed to delete account.');
        return;
    }

    ws.username = null;
    clients.delete(usernameToDelete);
    ws.close();
    broadcastUserList();
}

module.exports = {
    clients,
    conversations,
    send,
    sendError,
    broadcastUserList,
    broadcastMemberUpdate,
    requireRegistered,
    handleSignup,
    handleLogin,
    handleCreateConversation,
    handleJoinConversation,
    handleReceipt,
    handleSendMessage,
    handleTyping,
    handleStartDM,
    handleCreateGroup,
    handleAcceptGroupInvite,
    handleLeaveGroup,
    handleGetPendingInvites,
    handleDeclineGroupInvite,
    handleResumeSession,
    handleDeleteAccount,
    handleReceipt
};
