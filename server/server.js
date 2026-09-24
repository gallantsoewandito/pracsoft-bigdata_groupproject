const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const {
    clients,
    conversations,
    send,
    sendError,
    broadcastUserList,
    broadcastMemberUpdate,
    handleSignup,
    handleLogin,
    handleCreateConversation,
    handleJoinConversation,
    handleSendMessage,
    handleStartDM,
    handleCreateGroup,
    handleTyping
    ,handleAcceptGroupInvite
    ,handleLeaveGroup
} = require('./handler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000)

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    console.log('New client connected');
    ws.username = null;

    ws.on('message', async (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            sendError(ws, 'Malformed message (not valid JSON).');
            return;
        }

        try {
            switch (data.type) {
                case 'signup':
                    await handleSignup(ws, data);
                    break;
                case 'login':
                    await handleLogin(ws, data);
                    break;
                case 'register_public_key':
                    handleRegisterPublicKey(ws, data);
                    break;
                case 'create_conversation':
                    await handleCreateConversation(ws);
                    break;
                case 'join_conversation':
                    await handleJoinConversation(ws, data);
                    break;
                case 'send_message':
                    await handleSendMessage(ws, data);
                    break;
                case 'typing':
                    await handleTyping(ws, data);
                    break;
                case 'fetch_history':
                    await handleFetchHistory(ws, data);
                    break;
                case 'start_dm': 
                    await handleStartDM(ws, data); 
                    break;
                case 'create_group':
                    await handleCreateGroup(ws, data);
                    break;
                case 'accept_group_invite':
                    await handleAcceptGroupInvite(ws, data);
                    break;
                case 'leave_group':
                    await handleLeaveGroup(ws, data);
                    break;
                case 'ping':
                    send(ws, { type: 'pong' });
                    break;
                default:
                    sendError(ws, `Unknown message type: ${data.type}`);
            }
        } catch (err) {
            console.error('Handler error:', err);
            sendError(ws, 'Server error processing your request.');
        }
    });

    ws.on('close', () => {
    if (ws.username) {
        clients.delete(ws.username);
        for (const [conversationId, members] of conversations.entries()) {
            if (members.delete(ws.username)) {
                broadcastMemberUpdate(conversationId);
                for (const username of members) {
                    const client = clients.get(username);
                    if (client && client.ws && client.ws.readyState === 1) {
                        send(client.ws, { type: 'typing', conversationId, username: ws.username, isTyping: false });
                    }
                }
            }
        }
        broadcastUserList();
    }
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});