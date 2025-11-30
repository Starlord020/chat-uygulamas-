const express = require('express');
const app = express();
const http = require('http').Server(app);
const fs = require('fs');
const ogs = require('open-graph-scraper'); // Link önizleme kütüphanesi
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8 
});
const { ExpressPeerServer } = require('peer');

const ROOM_PASS = process.env.ODA_SIFRESI; 

if (!ROOM_PASS) {
    console.warn("UYARI: ODA_SIFRESI ayarlanmamış!");
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
    
    socket.on('check-room-pass', (inputPass) => {
        if (inputPass === ROOM_PASS) socket.emit('room-pass-success');
        else socket.emit('room-pass-error');
    });

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

        // --- YENİ: Yazıyor Göstergesi ---
        socket.on('typing', () => {
            socket.to(roomId).emit('displayTyping', { userId: socket.id, nickname: nickname });
        });
        
        socket.on('stop-typing', () => {
            socket.to(roomId).emit('hideTyping', { userId: socket.id });
        });

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

        // MESAJ İŞLEME (GÜNCELLENDİ: Link Preview + Reply)
        const handleMessage = async (type, payload) => {
            let content = "";
            let replyTo = null;

            // Payload string mi obje mi kontrol et
            if (typeof payload === 'object' && payload !== null && type === 'text') {
                content = payload.content;
                replyTo = payload.replyTo; // { user: 'Ali', content: 'Merhaba' }
            } else {
                content = payload;
            }

            if(type === 'text' && content.startsWith('::SYS::')) {
                 io.to(roomId).emit('createMessage', { type, user: nickname, content, senderId: socket.id, time: getTime() });
                 return;
            }

            let msgData = { 
                type, 
                user: nickname, 
                content, 
                senderId: socket.id, 
                time: getTime(),
                replyTo: replyTo, // Yanıt bilgisini ekle
                preview: null 
            };

            // Link Önizleme Kontrolü (Sadece text mesajlarda)
            if (type === 'text') {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const urls = content.match(urlRegex);
                if (urls && urls.length > 0) {
                    try {
                        const { result } = await ogs({ url: urls[0] });
                        if (result.success) {
                            msgData.preview = {
                                title: result.ogTitle || result.twitterTitle,
                                description: result.ogDescription || result.twitterDescription,
                                image: (result.ogImage && result.ogImage[0] && result.ogImage[0].url) || 
                                       (result.twitterImage && result.twitterImage[0] && result.twitterImage[0].url)
                            };
                        }
                    } catch (err) {
                        console.log("Link önizleme hatası:", err);
                    }
                }
            }

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
    
    function getTime(){
        return new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda çalışıyor.`); });
