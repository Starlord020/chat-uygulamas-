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

// --- VERİTABANI ---
const USERS_FILE = './users.json';
let usersDB = {};

if (fs.existsSync(USERS_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) {}
} else {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
}

// --- CANLI VERİLER ---
let messageHistory = []; 
const MAX_HISTORY = 50;

// Kim online, peerId'si ne, kamerası açık mı?
let onlineSessions = {}; // socket.id -> { nickname, peerId, cam: false, screen: false }

io.on('connection', (socket) => {
    
    // 1. KAYIT
    socket.on('register', (username, password) => {
        if (usersDB[username]) {
            socket.emit('auth-error', 'Bu isim zaten alınmış.');
        } else {
            usersDB[username] = password;
            saveUsers();
            socket.emit('register-success', 'Kayıt başarılı! Giriş yapabilirsin.');
            broadcastUserList(); // Listeyi güncelle (Gri olarak görünsün)
        }
    });

    // 2. GİRİŞ
    socket.on('login', (username, password) => {
        if (usersDB[username] && usersDB[username] === password) {
            socket.emit('login-success', username);
        } else {
            socket.emit('auth-error', 'Hatalı bilgiler.');
        }
    });

    // 3. ODAYA KATILMA
    socket.on('join-room', (roomId, peerId, nickname) => {
        socket.join(roomId);
        
        // Oturumu kaydet
        onlineSessions[socket.id] = { 
            nickname: nickname, 
            peerId: peerId, 
            cam: false, 
            screen: false 
        };
        
        broadcastUserList(roomId); // Herkese listeyi at
        socket.emit('load-history', messageHistory);
        socket.to(roomId).emit('user-connected', peerId, nickname);

        // Mesaj
        socket.on('message', (msg) => handleMessage(roomId, 'text', msg, nickname));
        socket.on('image', (img) => handleMessage(roomId, 'image', img, nickname));
        socket.on('voice', (voice) => handleMessage(roomId, 'audio', voice, nickname));

        // --- MEDYA DURUMU GÜNCELLEME (YENİ) ---
        socket.on('media-status', (status) => {
            if (onlineSessions[socket.id]) {
                onlineSessions[socket.id].cam = status.cam;
                onlineSessions[socket.id].screen = status.screen;
                broadcastUserList(roomId);
            }
        });

        // ÇIKIŞ
        socket.on('disconnect', () => {
            delete onlineSessions[socket.id];
            broadcastUserList(roomId);
            socket.to(roomId).emit('user-disconnected', peerId, nickname);
        });
    });

    function handleMessage(roomId, type, content, nickname) {
        const msgData = {
            type: type, 
            user: nickname,
            content: content,
            senderId: socket.id,
            time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})
        };
        messageHistory.push(msgData);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.to(roomId).emit('createMessage', msgData);
    }

    // --- LİSTE GÖNDERME FONKSİYONU ---
    function broadcastUserList(roomId = "ozel-oda-v1") {
        // Tüm kayıtlı kullanıcıları al
        const allUsers = Object.keys(usersDB).map(username => {
            // Bu kullanıcı şu an online mı?
            const session = Object.values(onlineSessions).find(s => s.nickname === username);
            
            if (session) {
                // ONLİNE İSE
                return {
                    nickname: username,
                    online: true,
                    peerId: session.peerId,
                    cam: session.cam,
                    screen: session.screen
                };
            } else {
                // OFFLİNE İSE
                return {
                    nickname: username,
                    online: false
                };
            }
        });

        io.to(roomId).emit('update-user-list', allUsers);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
