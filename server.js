const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const users = {};

io.on('connection', (socket) => {

    socket.on('join_room', (data) => {
        socket.username = data.username || 'زائر';
        socket.room = data.room || 'general';
        socket.join(socket.room);

        users[socket.id] = { 
            id: socket.id, 
            username: socket.username, 
            room: socket.room 
        };

        io.to(socket.room).emit('update_users', Object.values(users));

        socket.to(socket.room).emit('chat_message', {
            username: 'النظام',
            message: `${socket.username} انضم إلى المحادثة.`
        });
    });

    socket.on('send_message', (data) => {
        io.to(data.room).emit('chat_message', {
            username: socket.username,
            message: data.message,
            image: data.image || null
        });
    });

    socket.on('send_private_msg', (data) => {
        if (data.targetSocketId && io.sockets.sockets.get(data.targetSocketId)) {
            io.to(data.targetSocketId).emit('receive_private_msg', {
                senderId: socket.id,
                senderName: socket.username,
                message: data.message,
                image: data.image || null
            });
        }
    });

    socket.on('typing', (data) => {
        socket.to(data.room).emit('display_typing', { username: socket.username });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.room).emit('hide_typing');
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const disconnectedUser = users[socket.id];
            delete users[socket.id];

            io.to(disconnectedUser.room).emit('update_users', Object.values(users));
            io.to(disconnectedUser.room).emit('chat_message', {
                username: 'النظام',
                message: `${disconnectedUser.username} غادر المحادثة.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ: ${PORT}`);
});
