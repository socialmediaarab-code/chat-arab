const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// استبدل هذا بالـ Client ID الخاص بك من Google Cloud Console
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// الاتصال بقاعدة بيانات MongoDB Atlas السحابية
mongoose.connect('mongodb+srv://socialmediaarab_db_user:i0FCXmqnPJIuK4th@cluster0.ookuhnv.mongodb.net/arabic-chat?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
.catch(err => console.log('خطأ في الاتصال بقاعدة البيانات:', err));

// تعريف نموذج المستخدم (User Schema)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    password: { type: String }, // قد يكون فارغاً في حال تسجيل الدخول عبر جوجل
    googleId: { type: String }
});

const User = mongoose.model('User', userSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// مسار تسجيل الدخول العادي بالبريد وكلمة المرور
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user = await User.findOne({ username });
        
        if (!user) {
            // إذا لم يكن المستخدم موجوداً، نقوم بإنشائه تلقائياً (تسجيل جديد)
            const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
            user = new User({ username, password: hashedPassword });
            await user.save();
        } else if (user.password) {
            // إذا كان المستخدم موجوداً وله كلمة مرور، نتحقق منها
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'كلمة المرور غير صحيحة' });
            }
        }
        res.json({ success: true, username: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// مسار المصادقة عبر جوجل (Google Auth)
app.post('/api/google-login', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
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
        console.error('Google Auth Error:', err);
        res.status(400).json({ success: false, message: 'فشل المصادقة عبر جوجل' });
    }
});

// إدارة الشات عبر Socket.io
io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    socket.on('join', (username) => {
        socket.username = username;
        io.emit('message', { system: true, text: `انضم ${username} إلى الغرفة` });
    });

    socket.on('chatMessage', (msg) => {
        if (socket.username) {
            io.emit('message', { username: socket.username, text: msg });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            io.emit('message', { system: true, text: `غادر ${socket.username} الغرفة` });
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ: ${PORT}`);
});
