const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// دعم استقبال الملفات والصور الكبيرة حتى 10 ميجابايت
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

app.use(express.static('public'));

const users = {}; 
const rooms = ['العامة', 'مسابقات', 'تعارف'];

io.on('connection', (socket) => {

    // الانضمام الأولي للمستخدم
    socket.on('join-room', ({ username, room }) => {
        const targetRoom = rooms.includes(room) ? room : 'العامة';
        users[socket.id] = { username, room: targetRoom };
        socket.join(targetRoom);

        io.to(targetRoom).emit('chat-message', {
            user: 'النظام',
            text: `انضم ${username} إلى غرفة [${targetRoom}]`,
            system: true
        });

        updateRoomUsers(targetRoom);
        socket.emit('init-rooms', { rooms, currentRoom: targetRoom });
    });

    // التنقل بين الغرف
    socket.on('switch-room', (newRoom) => {
        const user = users[socket.id];
        if (!user || user.room === newRoom || !rooms.includes(newRoom)) return;

        const oldRoom = user.room;
        socket.leave(oldRoom);
        io.to(oldRoom).emit('chat-message', {
            user: 'النظام',
            text: `غادر ${user.username} الغرفة`,
            system: true
        });
        updateRoomUsers(oldRoom);

        user.room = newRoom;
        socket.join(newRoom);
        io.to(newRoom).emit('chat-message', {
            user: 'النظام',
            text: `انضم ${user.username} إلى غرفة [${newRoom}]`,
            system: true
        });
        updateRoomUsers(newRoom);
    });

    // إرسال رسالة نصية أو صورة في الغرفة العامة
    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (user) {
            io.to(user.room).emit('chat-message', {
                user: user.username,
                text: data.text || null,
                image: data.image || null,
                system: false
            });
        }
    });

    // إرسال رسالة خاصة لمستخدم محدد
    socket.on('send-private-message', ({ targetId, message, image }) => {
        const sender = users[socket.id];
        if (sender && users[targetId]) {
            io.to(targetId).emit('private-message', {
                fromId: socket.id,
                fromUser: sender.username,
                message: message || null,
                image: image || null
            });
            socket.emit('private-message-sent', {
                toId: targetId,
                toUser: users[targetId].username,
                message: message || null,
                image: image || null
            });
        }
    });

    // عند قطع الاتصال
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const room = user.room;
            io.to(room).emit('chat-message', {
                user: 'النظام',
                text: `غادر ${user.username} الدردشة`,
                system: true
            });
            delete users[socket.id];
            updateRoomUsers(room);
        }
    });

    function updateRoomUsers(room) {
        const roomUsers = Object.entries(users)
            .filter(([_, u]) => u.room === room)
            .map(([id, u]) => ({ id, username: u.username }));
        io.to(room).emit('update-user-list', roomUsers);
    }
});

server.listen(3000, () => {
    console.log('الدردشة تعمل الان على: http://localhost:3000');
});