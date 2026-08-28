const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ضع الـ Client ID الخاص بجوجل هنا
const GOOGLE_CLIENT_ID = '593400807452-hasied40uonfha4fh157c7vtb0tibkk4.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json());
app.use(express.static('public'));

// الاتصال بقاعدة البيانات (MongoDB)
mongoose.connect('mongodb://127.0.0.1:27017/arabic-chat', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح')).catch(err => console.log('خطأ في الاتصال بقاعدة البيانات:', err));

// مسار التسجيل بالبريد
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني مستخدم مسبقاً' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        user = new User({ username, email, password: hashedPassword });
        await user.save();
        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
    }
});

// مسار تسجيل الدخول بالبريد
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !user.password) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }
        res.json({ success: true, username: user.username });
    } catch (err) {
        res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
    }
});

// مسار تسجيل الدخول عبر جوجل
app.post('/api/google-login', async (req, res) => {
    try {
        const { credential } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ username: name, email, googleId });
            await user.save();
        }
        res.json({ success: true, username: user.username });
    } catch (err) {
        res.status(400).json({ success: false, error: 'فشل المصادقة عبر جوجل' });
    }
});

// إعدادات الـ Socket.io للشات
io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.username = data.username;
        socket.join(data.room);
        updateUsersList();
    });

    socket.on('send_message', (data) => {
        io.to(data.room).emit('chat_message', {
            username: socket.username,
            message: data.message,
            image: data.image
        });
    });

    socket.on('send_private_msg', (data) => {
        socket.to(data.targetSocketId).emit('receive_private_msg', {
            senderId: socket.id,
            senderName: socket.username,
            message: data.message,
            image: data.image
        });
    });

    socket.on('typing', (data) => {
        socket.to(data.room).emit('display_typing', { username: socket.username });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.room).emit('hide_typing');
    });

    socket.on('disconnect', () => {
        updateUsersList();
    });
});

function updateUsersList() {
    const users = [];
    for (let [id, socket] of io.of('/').sockets) {
        if (socket.username) {
            users.push({ id, username: socket.username });
        }
    }
    io.emit('update_users', users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ ${PORT}`);
});
