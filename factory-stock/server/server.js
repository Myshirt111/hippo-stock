// server.js
require('dotenv').config(); // เพิ่ม: โหลดค่าความลับจากไฟล์ .env
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken'); // เพิ่ม: นำเข้าระบบ Token
const bcrypt = require('bcrypt'); // เพิ่ม: นำเข้าระบบเข้ารหัสผ่าน

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// สร้างโฟลเดอร์ uploads อัตโนมัติถ้ายังไม่มี
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- ส่วนที่ 1: ระบบสร้างหมวดหมู่งานอัตโนมัติ (กัน Error) ---
const initCategories = async () => {
    const defaultCats = ["ติดตั้งบูธ", "งานเหล็ก", "งานสติ๊กเกอร์", "แพคกิ้ง", "งานสี", "ขนส่ง พรบ.", "งานไม้"];
    for (const cat of defaultCats) {
        await prisma.category.upsert({
            where: { name: cat },
            update: {},
            create: { name: cat }
        });
    }
    console.log("✅ โหลดหมวดหมู่งานเริ่มต้นเรียบร้อย");
};
initCategories();

// --- ใหม่: Middleware สำหรับตรวจบัตร (ยามเฝ้า API) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // ดึง token ออกมาจากคำว่า "Bearer [token]"
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ error: "ไม่อนุญาตให้เข้าถึง กรุณาเข้าสู่ระบบก่อน" });

    jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
        if (err) return res.status(403).json({ error: "บัตรผ่านหมดอายุหรือไม่ถูกต้อง" });
        req.user = user; // บันทึกข้อมูลคนใช้งานไว้
        next(); // บัตรผ่าน ถูกต้อง! ยอมให้ไปทำคำสั่งต่อไปได้
    });
};

// --- ส่วนที่ 2: API ดึงข้อมูลไปโชว์หน้าเว็บ (เปิดสาธารณะ ไม่ต้องล็อกยาม) ---
app.get('/api/items', async (req, res) => {
  const items = await prisma.item.findMany({ include: { categories: true }, orderBy: { id: 'desc' } });
  res.json(items);
});

// --- ส่วนที่ 3: API สำหรับเพิ่มของใหม่เข้าสต็อก (ล็อคกุญแจแล้ว) ---
// สังเกตว่ามีคำว่า authenticateToken คั่นกลาง เพื่อตรวจบัตรก่อนอัปโหลด
app.post('/api/items', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { name, quantity, unit, categories, expiryDate } = req.body;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        
        let categoryConnectOrCreate = [];
        if (categories) {
            const parsedCats = JSON.parse(categories);
            categoryConnectOrCreate = parsedCats.map(cat => ({
                where: { name: cat },
                create: { name: cat }
            }));
        }

        const newItem = await prisma.item.create({
            data: {
                name: name,
                quantity: parseFloat(quantity || 0),
                unit: unit,
                imageUrl: imageUrl,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                isTrackExpiry: !!expiryDate,
                categories: { connectOrCreate: categoryConnectOrCreate }
            }
        });
        res.json({ success: true, item: newItem });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
    }
});

// API 4: ลบสินค้าออกจากสต็อก (ล็อคกุญแจแล้ว)
app.delete('/api/items/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.item.delete({
            where: { id: parseInt(id) }
        });
        res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "ลบสินค้าไม่สำเร็จ" });
    }
});

// API 5: อัปเดตจำนวนสินค้า (แก้ไขสต็อก) (ล็อคกุญแจแล้ว)
app.patch('/api/items/:id/stock', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity } = req.body;
        
        const updatedItem = await prisma.item.update({
            where: { id: parseInt(id) },
            data: { quantity: parseInt(quantity) }
        });
        
        res.json(updatedItem);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "อัปเดตจำนวนไม่สำเร็จ" });
    }
});

// API: สมัครพนักงานใหม่ (เพิ่มระบบเข้ารหัสผ่าน)
app.post('/api/register', async (req, res) => {
    try {
        const { empId, name, password } = req.body;
        
        const existingEmp = await prisma.employee.findUnique({ where: { empId } });
        if (existingEmp) return res.status(400).json({ error: "รหัสพนักงานนี้มีในระบบแล้ว" });

        // ปั่นรหัสผ่านให้เป็นข้อความอ่านไม่ออกก่อนลง Database
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.employee.create({
            data: { empId, name, password: hashedPassword, role: "staff" }
        });
        res.json({ message: "ลงทะเบียนสำเร็จ" });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาด" });
    }
});

// API: เข้าสู่ระบบ (ออกบัตร Token)
app.post('/api/login', async (req, res) => {
    try {
        const { empId, password } = req.body;
        let userRole = '';
        let userName = '';

        // ดึงรหัสแอดมินจากไฟล์ .env แทนการฝังในโค้ด
        const ADMIN_ID = process.env.ADMIN_ID || 'HIPPO';
        const ADMIN_PASS = process.env.ADMIN_PASS || '999999';

        if (empId === ADMIN_ID && password === ADMIN_PASS) {
            userRole = 'admin';
            userName = 'ผู้ดูแลระบบ';
        } else {
            const emp = await prisma.employee.findUnique({ where: { empId } });
            if (!emp) return res.status(401).json({ error: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" });

            // ตรวจสอบรหัสผ่านที่เข้ารหัสไว้ (รองรับรหัสเก่าที่ยังไม่เข้ารหัสด้วย)
            const validPassword = await bcrypt.compare(password, emp.password);
            if (!validPassword && password !== emp.password) {
                return res.status(401).json({ error: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" });
            }
            
            userRole = emp.role;
            userName = emp.name;
        }

        // สร้างบัตร Token อายุการใช้งาน 8 ชั่วโมง
        const token = jwt.sign(
            { empId: empId, role: userRole }, 
            process.env.JWT_SECRET || 'fallback_secret', 
            { expiresIn: '8h' }
        );

        // ส่งข้อมูลสิทธิ์ และ 'บัตร' กลับไปให้หน้าเว็บ
        res.json({ empId: empId, name: userName, role: userRole, token: token });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาด" });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend Server running on http://localhost:${PORT}`));