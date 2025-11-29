const express = require('express');
const app = express();
const http = require('http').Server(app);
const fs = require('fs');
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 
});
const { ExpressPeerServer } = require('peer');

app.use(express.static('public'));

const peerServer = ExpressPeerServer(http, { debug: true });
app.use('/peerjs', peerServer);

const USERS_FILE = './users.json';
let usersDB = {};
if (fs.existsSync(USERS_FILE)) { try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e){} } 
else { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB)); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2)); }

let messageHistory = []; 
const MAX_HISTORY = 50;
let onlineSessions = {}; 

io.on('connection', (socket) => {
    
    socket.on('register', (u, p) => {
        if (usersDB[u]) socket.emit('auth-error', 'İsim alınmış.');
        else { usersDB[u] = p; saveUsers(); socket.emit('register-success', 'Kayıt başarılı.'); broadcastUserList(); }
    });

    socket.on('login', (u, p) => {
        if (usersDB[u] && usersDB[u] === p) socket.emit('login-success', u);
        else socket.emit('auth-error', 'Hatalı bilgiler.');
    });

    socket.on('join-room', (roomId, peerId, nickname) => {
        socket.join(roomId);
        onlineSessions[socket.id] = { nickname, peerId, cam: false, screen: false };
        
        broadcastUserList(roomId);
        socket.emit('load-history', messageHistory);
        socket.to(roomId).emit('user-connected', peerId, nickname);

        // --- YENİ EKLENEN KISIM: Görüntü Modu Değişimi ---
        socket.on('stream-changed', (type) => {
            // type: 'camera' veya 'screen'
            socket.to(roomId).emit('user-stream-changed', { peerId: peerId, type: type });
        });
        // -------------------------------------------------

        socket.on('media-status', (status) => {
            if (onlineSessions[socket.id]) {
                onlineSessions[socket.id].cam = status.cam;
                onlineSessions[socket.id].screen = status.screen;
                broadcastUserList(roomId);
            }
        });

        const handleMessage = (type, content) => {
            const msgData = { type, user: nickname, content, senderId: socket.id, time: new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'}) };
            messageHistory.push(msgData);
            if(messageHistory.length > MAX_HISTORY) messageHistory.shift();
            io.to(roomId).emit('createMessage', msgData);
        };
        socket.on('message', m => handleMessage('text', m));
        socket.on('image', i => handleMessage('image', i));
        socket.on('voice', v => handleMessage('audio', v));

        socket.on('disconnect', () => {
            delete onlineSessions[socket.id];
            broadcastUserList(roomId);
            socket.to(roomId).emit('user-disconnected', peerId, nickname);
        });
    });

    function broadcastUserList(roomId = "ozel-oda-v1") {
        const allUsers = Object.keys(usersDB).map(username => {
            const session = Object.values(onlineSessions).find(s => s.nickname === username);
            return session ? { nickname: username, online: true, peerId: session.peerId, cam: session.cam, screen: session.screen } : { nickname: username, online: false };
        });
        io.to(roomId).emit('update-user-list', allUsers);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda çalışıyor.`); });
