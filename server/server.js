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
    handleCreateGroup
} = require('./handler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

wss.on('connection', (ws) => {
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
                case 'create_conversation':
                    await handleCreateConversation(ws);
                    break;
                case 'join_conversation':
                    await handleJoinConversation(ws, data);
                    break;
                case 'send_message':
                    await handleSendMessage(ws, data);
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
                }
            }
            broadcastUserList();
            console.log(`${ws.username} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});