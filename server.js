const express = require('express');
const app = express();
const http = require('http').Server(app);
const fs = require('fs');
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 
});
const { ExpressPeerServer } = require('peer');

// --- ŞİFRE AYARI ---
// Yedek şifre YOK. Sadece Render.com'daki ODA_SIFRESI geçerli.
const ROOM_PASS = process.env.ODA_SIFRESI; 

if (!ROOM_PASS) {
    console.warn("UYARI: ODA_SIFRESI environment variable olarak ayarlanmamış! Giriş yapılamayabilir.");
}

app.use(express.static('public'));

const peerServer = ExpressPeerServer(http, { debug: true, path: '/' });
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
    
    // 1. ODA ŞİFRESİ KONTROLÜ (GÜVENLİ YÖNTEM)
    socket.on('check-room-pass', (inputPass) => {
        // Sunucudaki gizli şifre ile karşılaştır
        if (inputPass === ROOM_PASS) {
            socket.emit('room-pass-success');
        } else {
            socket.emit('room-pass-error');
        }
    });

    // KAYIT & GİRİŞ
    socket.on('register', (u, p) => {
        if (usersDB[u]) socket.emit('auth-error', 'İsim alınmış.');
        else { usersDB[u] = p; saveUsers(); socket.emit('register-success', 'Kayıt başarılı.'); broadcastUserList(); }
    });

    socket.on('login', (u, p) => {
        if (usersDB[u] && usersDB[u] === p) socket.emit('login-success', u);
        else socket.emit('auth-error', 'Hatalı bilgiler.');
    });

    // ODAYA GİRİŞ
    socket.on('join-room', (roomId, peerId, nickname) => {
        socket.join(roomId);
        onlineSessions[socket.id] = { nickname, peerId, cam: false, screen: false };
        
        broadcastUserList(roomId);
        socket.emit('load-history', messageHistory);
        socket.to(roomId).emit('user-connected', peerId, nickname);

        socket.on('media-status', (status) => {
            if (onlineSessions[socket.id]) {
                onlineSessions[socket.id].cam = status.cam;
                onlineSessions[socket.id].screen = status.screen;
                broadcastUserList(roomId);
            }
        });

        socket.on('stream-changed', (type) => {
            socket.to(roomId).emit('user-stream-changed', { peerId: peerId, type: type });
        });
        // --- YOUTUBE SENKRONİZASYONU ---
        socket.on('yt-sync', (data) => {
            // Gelen YouTube komutunu (oynat, durdur, yeni video, süre) odadaki diğer herkese gönder
            socket.to(roomId).emit('yt-sync', data); 
        });
        // MESAJ
        const handleMessage = (type, content) => {
            // Sistem mesajları (::SYS:: ile başlayanlar) geçmişe kaydedilmesin
            if(type === 'text' && content.startsWith('::SYS::')) {
                 io.to(roomId).emit('createMessage', { type, user: nickname, content, senderId: socket.id, time: new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'}) });
                 return;
            }

            const msgData = { type, user: nickname, content, senderId: socket.id, time: new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'}) };
            messageHistory.push(msgData);
            if(messageHistory.length > MAX_HISTORY) messageHistory.shift();
            io.to(roomId).emit('createMessage', msgData);
        };
        socket.on('message', m => handleMessage('text', m));
        socket.on('image', i => handleMessage('image', i));
        socket.on('voice', v => handleMessage('audio', v));

        // ÇIKIŞ
        socket.on('disconnect', () => {
            delete onlineSessions[socket.id]; 
            broadcastUserList(roomId); 
            socket.to(roomId).emit('user-disconnected', peerId, nickname);
        });
    });

    function broadcastUserList(roomId = "ozel-oda-v1") {
        const allUsers = Object.keys(usersDB).map(username => {
            const session = Object.values(onlineSessions).find(s => s.nickname === username);
            if (session) {
                return { 
                    nickname: username, 
                    online: true, 
                    peerId: session.peerId, 
                    cam: session.cam, 
                    screen: session.screen 
                };
            } else {
                return { nickname: username, online: false };
            }
        });
        io.to(roomId).emit('update-user-list', allUsers);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda çalışıyor.`); });

