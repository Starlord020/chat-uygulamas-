const express = require('express');
const app = express();
const http = require('http').Server(app);

// --- GÜNCELLEME BURADA ---
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 // 100 MB'a kadar izin ver (Resimler için şart)
});
// -------------------------

const { ExpressPeerServer } = require('peer');

app.use(express.static('public'));

const peerServer = ExpressPeerServer(http, { debug: true });
app.use('/peerjs', peerServer);

// Mesaj Geçmişi
let messageHistory = []; 
const MAX_HISTORY = 30;

io.on('connection', (socket) => {
    
    socket.on('join-room', (roomId, userId, nickname) => {
        socket.join(roomId);
        
        socket.emit('load-history', messageHistory);
        socket.to(roomId).emit('user-connected', userId, nickname);

        // Mesaj İşleme
        socket.on('message', (msg) => handleMessage('text', msg));
        socket.on('image', (img) => handleMessage('image', img));
        socket.on('voice', (voice) => handleMessage('audio', voice));

        const handleMessage = (type, content) => {
            const msgData = {
                type: type, 
                user: nickname,
                content: content, // Resim buraya base64 olarak gelir
                senderId: socket.id,
                time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})
            };
            
            messageHistory.push(msgData);
            if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
            
            // Tüm odaya yay
            io.to(roomId).emit('createMessage', msgData);
        };

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', userId, nickname);
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});