const express = require('express');
const app = express();
const http = require('http').Server(app);
const fs = require('fs'); // Dosya işlemleri için
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 
});
const { ExpressPeerServer } = require('peer');

app.use(express.static('public'));

const peerServer = ExpressPeerServer(http, { debug: true });
app.use('/peerjs', peerServer);

// --- VERİTABANI (Basit JSON Dosyası) ---
const USERS_FILE = './users.json';
let usersDB = {};

// Dosya varsa yükle, yoksa oluştur
if (fs.existsSync(USERS_FILE)) {
    usersDB = JSON.parse(fs.readFileSync(USERS_FILE));
} else {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
}

// --- DEĞİŞKENLER ---
let messageHistory = []; 
const MAX_HISTORY = 50;
let onlineUsers = {}; // Soket ID -> Nickname eşleşmesi

io.on('connection', (socket) => {
    
    // 1. KAYIT OLMA
    socket.on('register', (username, password) => {
        if (usersDB[username]) {
            socket.emit('auth-error', 'Bu kullanıcı adı zaten alınmış.');
        } else {
            usersDB[username] = password;
            saveUsers();
            socket.emit('register-success', 'Kayıt başarılı! Şimdi giriş yapabilirsin.');
        }
    });

    // 2. GİRİŞ YAPMA
    socket.on('login', (username, password) => {
        if (usersDB[username] && usersDB[username] === password) {
            socket.emit('login-success', username);
        } else {
            socket.emit('auth-error', 'Kullanıcı adı veya şifre yanlış.');
        }
    });

    // 3. ODAYA KATILMA
    socket.on('join-room', (roomId, userId, nickname) => {
        socket.join(roomId);
        
        // Online listesine ekle
        onlineUsers[socket.id] = nickname;
        
        // Herkese güncel listeyi gönder
        io.to(roomId).emit('update-user-list', Object.values(onlineUsers));

        socket.emit('load-history', messageHistory);
        socket.to(roomId).emit('user-connected', userId, nickname);

        // Mesaj İşleme
        const handleMessage = (type, content) => {
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
        };

        socket.on('message', (msg) => handleMessage('text', msg));
        socket.on('image', (img) => handleMessage('image', img));
        socket.on('voice', (voice) => handleMessage('audio', voice));

        socket.on('disconnect', () => {
            // Listeden çıkar
            delete onlineUsers[socket.id];
            // Listeyi güncelle
            io.to(roomId).emit('update-user-list', Object.values(onlineUsers));
            
            socket.to(roomId).emit('user-disconnected', userId, nickname);
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
