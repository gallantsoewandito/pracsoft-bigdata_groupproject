const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

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
    handleTyping,
    handleAcceptGroupInvite,
    handleLeaveGroup,
    handleGetPendingInvites,
    handleDeclineGroupInvite
} = require('./handler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });


// -----------------------------------------------------------------------------
// Attachment uploads
// -----------------------------------------------------------------------------
// Files live on the Node server's filesystem. Nothing here changes or creates
// encryption/API keys. Chat messages still use the existing encrypted text path.
const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;       // 75 MB per file
const MAX_UPLOAD_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB total attachment pool

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeExtension(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

function makeStoredFileName(originalName) {
    const randomPart = Math.random().toString(36).slice(2, 12);
    return `${Date.now()}-${randomPart}${safeExtension(originalName)}`;
}

async function listStoredUploads() {
    const names = await fs.promises.readdir(UPLOAD_DIR);
    const rows = [];

    for (const name of names) {
        if (name.startsWith('.upload-')) continue;
        const fullPath = path.join(UPLOAD_DIR, name);
        try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.isFile()) {
                rows.push({ name, fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
            }
        } catch (_) {
            // File may have disappeared between readdir/stat. Ignore it.
        }
    }

    return rows;
}

async function makeRoomForUpload(incomingBytes) {
    if (incomingBytes > MAX_UPLOAD_STORAGE_BYTES) return false;

    const files = await listStoredUploads();
    let total = files.reduce((sum, file) => sum + file.size, 0);

    // Oldest attachments are evicted first, exactly as requested.
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const file of files) {
        if (total + incomingBytes <= MAX_UPLOAD_STORAGE_BYTES) break;
        try {
            await fs.promises.unlink(file.fullPath);
            total -= file.size;
            console.log(`Attachment cleanup: deleted ${file.name}`);
        } catch (err) {
            console.warn(`Could not delete old attachment ${file.name}:`, err.message);
        }
    }

    return total + incomingBytes <= MAX_UPLOAD_STORAGE_BYTES;
}

function streamRequestToFile(req, outputPath, maxBytes) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath, { flags: 'wx' });
        let bytes = 0;
        let settled = false;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            output.destroy();
            fs.promises.unlink(outputPath).catch(() => {});
            reject(err);
        };

        req.on('data', (chunk) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxBytes) {
                req.pause();
                fail(Object.assign(new Error('File too large.'), { code: 'FILE_TOO_LARGE' }));
                return;
            }
            if (!output.write(chunk)) req.pause();
        });

        output.on('drain', () => {
            if (!settled) req.resume();
        });

        req.on('end', () => {
            if (settled) return;
            output.end(() => {
                if (settled) return;
                settled = true;
                resolve(bytes);
            });
        });

        req.on('aborted', () => fail(new Error('Upload aborted.')));
        req.on('error', fail);
        output.on('error', fail);
    });
}

// Upload raw file bytes. We deliberately keep this simple for the university
// prototype: the user must currently be connected and be a member of the chat.
app.post('/api/upload', async (req, res) => {
    const username = String(req.get('x-chat-username') || '');
    const conversationId = String(req.get('x-conversation-id') || '');
    const originalName = decodeURIComponent(String(req.query.name || 'attachment'));
    const mimeType = decodeURIComponent(String(req.query.type || 'application/octet-stream'));

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

    const storedName = makeStoredFileName(originalName);
    const tempName = `.upload-${storedName}.tmp`;
    const tempPath = path.join(UPLOAD_DIR, tempName);
    const finalPath = path.join(UPLOAD_DIR, storedName);

    try {
        const bytesWritten = await streamRequestToFile(req, tempPath, MAX_UPLOAD_BYTES);
        const hasRoom = await makeRoomForUpload(bytesWritten);

        if (!hasRoom) {
            await fs.promises.unlink(tempPath).catch(() => {});
            return res.status(507).json({ error: 'Attachment storage is full.' });
        }

        await fs.promises.rename(tempPath, finalPath);

        return res.json({
            name: originalName,
            mime: mimeType || 'application/octet-stream',
            size: bytesWritten,
            url: `/uploads/${encodeURIComponent(storedName)}`
        });
    } catch (err) {
        await fs.promises.unlink(tempPath).catch(() => {});
        if (err && err.code === 'FILE_TOO_LARGE') {
            return res.status(413).json({ error: 'File is larger than the 75 MB limit.' });
        }
        console.error('Attachment upload failed:', err);
        return res.status(500).json({ error: 'Failed to upload attachment.' });
    }
});

// Serve inline previews. Adding ?download=1 forces a normal file download.
app.get('/uploads/:fileName', async (req, res) => {
    const requested = String(req.params.fileName || '');
    const safeName = path.basename(requested);
    if (!safeName || safeName !== requested) return res.sendStatus(400);

    const fullPath = path.join(UPLOAD_DIR, safeName);

    try {
        await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch (_) {
        return res.status(404).send('Attachment expired or was removed to save storage space.');
    }

    if (req.query.download === '1') {
        const requestedDownloadName = path.basename(String(req.query.name || safeName));
        return res.download(fullPath, requestedDownloadName || safeName);
    }

    return res.sendFile(fullPath);
});

app.use(express.static(path.join(__dirname, '../client')));

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
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
                    handleTyping(ws, data);
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
                case 'get_pending_invites':
                    handleGetPendingInvites(ws);
                    break;
                case 'decline_group_invite':
                    handleDeclineGroupInvite(ws, data);
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

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
