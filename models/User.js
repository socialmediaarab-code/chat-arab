const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String }, // قد يكون فارغاً إذا سجل عبر جوجل
    googleId: { type: String }   // معرف جوجل في حال التسجيل به
});

module.exports = mongoose.model('User', UserSchema);
