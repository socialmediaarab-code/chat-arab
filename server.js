const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const users = {};

io.on('connection', (socket) => {
    console.log('مستخدم جديد اتصل:', socket.id);

    // تسجيل اسم المستخدم
    socket.on('join_room', (data) => {
        socket.username = data.username;
        socket.room = data.room || 'general';
        socket.join(socket.room);

        users[socket.id] = { username: data.username, room: socket.room };
        
        io.to(socket.room).emit('update_users', Object.values(users));
        socket.to(socket.room).emit('chat_message', {
            username: 'النظام',
            message: `${data.username} انضم إلى المحادثة.`
        });
    });

    // إرسال رسالة عامة
    socket.on('send_message', (data) => {
        io.to(data.room).emit('chat_message', {
            username: socket.username,
            message: data.message,
            image: data.image || null
        });
    });

    // إرسال رسالة خاصة
    socket.on('send_private_msg', (data) => {
        io.to(data.targetSocketId).emit('receive_private_msg', {
            senderId: socket.id,
            senderName: socket.username,
            message: data.message
        });
    });

    // أحداث الكتابة
    socket.on('typing', (data) => {
        socket.to(data.room).emit('display_typing', { username: data.username });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.room).emit('hide_typing');
    });

    // عند القطع
    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.id];
            io.to(socket.room).emit('update_users', Object.values(users));
            socket.to(socket.room).emit('chat_message', {
                username: 'النظام',
                message: `${socket.username} غادر المحادثة.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ: ${PORT}`);
});
