const supabase = require('./db');
const bcrypt = require('bcrypt')

const clients = new Map();
const conversations = new Map();

function send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
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
        if (clientData.ws.readyState === WebSocket.OPEN) {
            clientData.ws.send(payload);
        }
    }
}

function broadcastMemberUpdate(conversationId) {
    const members = Array.from(conversations.get(conversationId) || []);
    const payload = { type: 'member_update', conversationId, members };
    for (const username of members) {
        const client = clients.get(username);
        // SAFE CHECK: Only send if the user is currently online and has a valid ws
        if (client && client.ws) {
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
    
    send(ws, { type: 'registered', username: newUser.username });
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

    if (clients.has(user.username)) {
        const oldClient = clients.get(user.username);
        send(oldClient.ws, { type: 'error', message: 'You have been logged in from another device.' });
        oldClient.ws.close();
        clients.delete(user.username);
    }

    ws.username = user.username;
    clients.set(user.username, { ws: ws, id: user.id, lastMessageTime: 0 });

    send(ws, { type: 'registered', username: user.username });
    await loadInitialData(ws. user.id);
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

async function handleJoinConversation(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId } = data;
    
    if (!conversationId) {
        sendError(ws, 'join_conversation requires a conversationId.');
        return;
    }

    if (!conversations.has(conversationId)) {
        conversations.set(conversationId, new Set());
    }

    const clientData = clients.get(ws.username);

    await supabase
        .from('conversation_members')
        .upsert(
            [{ conversation_id: conversationId, user_id: clientData.id }],
            { onConflict: 'conversation_id, user_id' }
        );

    conversations.get(conversationId).add(ws.username);

    // 1. Fetch messages WITHOUT the join
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

    send(ws, {
        type: 'conversation_joined',
        conversationId,
        members: Array.from(conversations.get(conversationId)),
        history: formattedHistory,
    });

    broadcastMemberUpdate(conversationId);
}

async function handleSendMessage(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId, content } = data;

    const clientData = clients.get(ws.username);
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
    if (cleanMessage.length > 512) {
        sendError(ws, 'Message exceeds 512 character limit.');
        return;
    }

    const members = conversations.get(conversationId);
    if (!members || !members.has(ws.username)) {
        sendError(ws, 'You are not a member of that conversation.');
        return;
    }

    const senderData = clients.get(ws.username);

    // Save to database using the user's UUID
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

    if (error) {
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
        if (client && client.ws) {
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
        send(ws, {
            type: 'conversation_joined', 
            conversationId: existingConversationId,
            members: [ws.username, targetUsername],
            history: formattedHistory
        });
        broadcastMemberUpdate(existingConversationId);
    } else {
        const { data: newRow, error: createError } = await supabase
            .from('conversations')
            .insert([{}])
            .select()
            .single();
        
        if (createError) {
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
        send(ws, { 
            type: 'conversation_joined', 
            conversationId: newConvoId,
            members: [ws.username, targetUsername],
            history: [] 
        });
        broadcastMemberUpdate(newConvoId);
    }
}

async function handleCreateGroup(ws, data) {
    if (!requireRegistered(ws)) return;
    const { members: targetUsernames } = data;

    if (!Array.isArray(targetUsernames) || targetUsernames.length === 0) {
        sendError(ws, 'Invalid group members.');
        return;
    }

    const currentUserData = clients.get(ws.username);
    const allUsernames = [ws.username, ...targetUsernames];
    const allUserIds = [currentUserData.id];

    // Fetch database IDs for all selected users
    const { data: targetUsers, error: targetError } = await supabase
        .from('users')
        .select('id, username')
        .in('username', targetUsernames);

    if (targetError || !targetUsers) {
        sendError(ws, 'Failed to find users.');
        return;
    }

    for (const user of targetUsers) {
        allUserIds.push(user.id);
    }

    // Create the new conversation
    const { data: newRow, error: createError } = await supabase
        .from('conversations')
        .insert([{}])
        .select()
        .single();
    
    if (createError) {
        console.error('Supabase error creating group:', createError);
        sendError(ws, 'Failed to create group.');
        return;
    }

    const newConvoId = newRow.id;

    // Add all members to the database
    const memberInserts = allUserIds.map(userId => ({
        conversation_id: newConvoId,
        user_id: userId
    }));

    await supabase
        .from('conversation_members')
        .insert(memberInserts);

    // Track in server memory
    conversations.set(newConvoId, new Set(allUsernames));
    
    // Notify the creator
    send(ws, { 
        type: 'conversation_created', 
        conversationId: newConvoId,
        members: allUsernames,
        history: [] 
    });

    broadcastMemberUpdate(newConvoId);
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
    handleSendMessage,
    handleStartDM,
    handleCreateGroup
};