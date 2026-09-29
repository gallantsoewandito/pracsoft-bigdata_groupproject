const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const supabase = require('./db');

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
    handleReceipt,
    handleSendMessage,
    handleStartDM,
    handleCreateGroup,
    handleTyping,
    handleAcceptGroupInvite,
    handleLeaveGroup,
    handleGetPendingInvites,
    handleDeclineGroupInvite,
    handleResumeSession,
    handleDeleteAccount
} = require('./handler');

const BACKEND_URL = process.env.NODE_ENV === 'production' 
    ? 'https://pracsoft-bigdata-groupproject.onrender.com' 
    : `http://localhost:${process.env.PORT || 3000}`;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

// 1. CORS Middleware
app.use((req, res, next) => {
    const allowedOrigins = [
        'https://pracsoft-bigdatagroupproject.vercel.app',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
        'null'
    ];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Chat-Username, X-Conversation-Id');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// 2. Serve Static Files
app.use(express.static(path.join(__dirname, '../client')));

// 3. Attachment Upload Route (Supabase Storage ONLY)
app.post('/api/upload', async (req, res) => {
    const username = String(req.get('x-chat-username') || '');
    const conversationId = String(req.get('x-conversation-id') || '');
    const originalName = decodeURIComponent(String(req.query.name || 'attachment'));
    const mimeType = decodeURIComponent(String(req.query.type || 'application/octet-stream'));
    const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;

    if (!username || !clients.has(username)) {
        return res.status(401).json({ error: 'You must be logged in to upload files.' });
    }

    const members = conversations.get(conversationId);
    if (!members || !members.has(username)) {
        return res.status(403).json({ error: 'You are not a member of that conversation.' });
    }

    const contentLength = Number(req.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'File is larger than the 75 MB limit.' });
    }

    // Collect the file stream into a Buffer
    const chunks = [];
    let totalBytes = 0;

    await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_UPLOAD_BYTES) {
                return reject(Object.assign(new Error('File too large.'), { code: 'FILE_TOO_LARGE' }));
            }
            chunks.push(chunk);
        });
        req.on('end', resolve);
        req.on('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    
    // Generate safe filename
    const randomPart = Math.random().toString(36).slice(2, 12);
    const ext = path.extname(originalName).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
    const storedName = `${Date.now()}-${randomPart}${safeExt}`;
    const filePath = `${conversationId}/${storedName}`;

    try {
        // Upload directly to Supabase Storage
        const { data, error } = await supabase
            .storage
            .from('chat-attachments')
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: false
            });

        if (error) {
            console.error('Supabase storage upload error:', error);
            return res.status(500).json({ error: 'Failed to upload to storage.' });
        }

        // Get the permanent public URL
        const { data: publicUrlData } = supabase
            .storage
            .from('chat-attachments')
            .getPublicUrl(filePath);

        return res.json({
            name: originalName,
            mime: mimeType || 'application/octet-stream',
            size: totalBytes,
            url: publicUrlData.publicUrl
        });
    } catch (err) {
        console.error('Attachment upload failed:', err);
        if (err && err.code === 'FILE_TOO_LARGE') {
            return res.status(413).json({ error: 'File is larger than the 75 MB limit.' });
        }
        return res.status(500).json({ error: `Failed to upload attachment: ${err.message}` });
    }
});

// 4. WebSocket Heartbeat
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// 5. WebSocket Connection Handling
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', (err) => { console.error('WebSocket error:', err.message); });
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

        if (!data || typeof data !== 'object') {
            sendError(ws, 'Malformed message.');
            return;
        }

        try {
            if ((data.type === 'signup' || data.type === 'login') && ws.username) {
                sendError(ws, 'You are already logged in.');
                return;
            }

            switch (data.type) {
                case 'signup': await handleSignup(ws, data); break;
                case 'login': await handleLogin(ws, data); break;
                case 'resume_session': await handleResumeSession(ws, data); break; // NEW
                case 'delete_account': await handleDeleteAccount(ws, data); break;
                case 'create_conversation': await handleCreateConversation(ws); break;
                case 'join_conversation': await handleJoinConversation(ws, data); break;
                case 'receipt': await handleReceipt(ws, data); break;
                case 'send_message': await handleSendMessage(ws, data); break;
                case 'typing': handleTyping(ws, data); break;
                case 'start_dm': await handleStartDM(ws, data); break;
                case 'create_group': await handleCreateGroup(ws, data); break;
                case 'accept_group_invite': await handleAcceptGroupInvite(ws, data); break;
                case 'get_pending_invites': handleGetPendingInvites(ws); break;
                case 'decline_group_invite': handleDeclineGroupInvite(ws, data); break;
                case 'leave_group': await handleLeaveGroup(ws, data); break;
                case 'ping': send(ws, { type: 'pong' }); break;
                default: sendError(ws, `Unknown message type: ${data.type}`);
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

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});