// server.js
require('dotenv').config(); // โหลดค่าความลับจากไฟล์ .env
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken'); // ระบบ Token
const bcrypt = require('bcrypt'); // ระบบเข้ารหัสผ่าน

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// --- [จุดที่แก้ไขเพิ่มเติม] ชี้เป้าไปที่โฟลเดอร์ client เพื่อแสดงหน้าเว็บ ---
app.use(express.static(path.join(__dirname, '../client')));

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

// --- Middleware สำหรับตรวจบัตร (ยามเฝ้า API) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ error: "ไม่อนุญาตให้เข้าถึง กรุณาเข้าสู่ระบบก่อน" });

    jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
        if (err) return res.status(403).json({ error: "บัตรผ่านหมดอายุหรือไม่ถูกต้อง" });
        req.user = user;
        next();
    });
};

// --- ส่วนที่ 2: API ดึงข้อมูลไปโชว์หน้าเว็บ ---
app.get('/api/items', async (req, res) => {
  const items = await prisma.item.findMany({ include: { categories: true }, orderBy: { id: 'desc' } });
  res.json(items);
});

// --- ส่วนที่ 3: API สำหรับเพิ่มของใหม่เข้าสต็อก (แก้ไขเพิ่มการรับค่า price) ---
app.post('/api/items', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { name, quantity, price, unit, categories, expiryDate } = req.body; // รับ price เข้ามาเพิ่ม
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
                price: parseFloat(price || 0), // บันทึกราคาต้นทุน
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

// API 4: ลบสินค้าออกจากสต็อก
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

// API 5: อัปเดตจำนวนสินค้า
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

// API: สมัครพนักงานใหม่
app.post('/api/register', async (req, res) => {
    try {
        const { empId, name, password } = req.body;
        const existingEmp = await prisma.employee.findUnique({ where: { empId } });
        if (existingEmp) return res.status(400).json({ error: "รหัสพนักงานนี้มีในระบบแล้ว" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.employee.create({
            data: { empId, name, password: hashedPassword, role: "staff" }
        });
        res.json({ message: "ลงทะเบียนสำเร็จ" });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาด" });
    }
});

// API: เข้าสู่ระบบ
app.post('/api/login', async (req, res) => {
    try {
        const { empId, password } = req.body;
        let userRole = '';
        let userName = '';

        const ADMIN_ID = process.env.ADMIN_ID || 'HIPPO';
        const ADMIN_PASS = process.env.ADMIN_PASS || '999999';

        if (empId === ADMIN_ID && password === ADMIN_PASS) {
            userRole = 'admin';
            userName = 'ผู้ดูแลระบบ';
            
            // เพิ่มพิเศษ: สร้างโปรไฟล์แอดมินในฐานข้อมูลไว้ด้วย ป้องกัน Error ตอนแอดมินกดเบิกของ
            await prisma.employee.upsert({
                where: { empId: ADMIN_ID },
                update: {},
                create: { empId: ADMIN_ID, name: userName, password: 'sys-admin-pass', role: 'admin' }
            });
            
        } else {
            const emp = await prisma.employee.findUnique({ where: { empId } });
            if (!emp) return res.status(401).json({ error: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" });

            const validPassword = await bcrypt.compare(password, emp.password);
            if (!validPassword && password !== emp.password) {
                return res.status(401).json({ error: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" });
            }
            
            userRole = emp.role;
            userName = emp.name;
        }

        const token = jwt.sign(
            { empId: empId, role: userRole }, 
            process.env.JWT_SECRET || 'fallback_secret', 
            { expiresIn: '8h' }
        );

        res.json({ empId: empId, name: userName, role: userRole, token: token });
    } catch (error) {
        res.status(500).json({ error: "เกิดข้อผิดพลาด" });
    }
});


// ==========================================
// --- ส่วนที่เพิ่มใหม่: API สำหรับระบบเบิกของและโปรเจกต์ ---
// ==========================================

// API: ดึงรายชื่อโปรเจกต์ทั้งหมด
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await prisma.project.findMany({ orderBy: { id: 'desc' } });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลโปรเจกต์ได้" });
    }
});

// API: สร้างโปรเจกต์ใหม่ (ชื่องานใหม่)
app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        const newProject = await prisma.project.create({
            data: { name, description }
        });
        res.json({ success: true, project: newProject });
    } catch (error) {
        res.status(500).json({ error: "ไม่สามารถสร้างโปรเจกต์ได้ (ชื่ออาจซ้ำ)" });
    }
});

// API: เบิกของ / รับของเข้า (สร้าง Transaction และอัปเดตสต็อกอัตโนมัติ)
app.post('/api/transactions', authenticateToken, async (req, res) => {
    try {
        // type คือ "IN" (รับเข้า) หรือ "OUT" (เบิกออก)
        const { type, quantity, itemId, projectId } = req.body;
        const empId = req.user.empId; // ดึงรหัสพนักงานจากบัตรคิว Token อัตโนมัติ

        // หาข้อมูลสินค้าปัจจุบันเพื่อเอาราคาต้นทุน และเช็คจำนวน
        const item = await prisma.item.findUnique({ where: { id: parseInt(itemId) } });
        if (!item) return res.status(404).json({ error: "ไม่พบสินค้า" });

        const qty = parseFloat(quantity);
        if (type === 'OUT' && item.quantity < qty) {
            return res.status(400).json({ error: `สต็อกไม่เพียงพอ! (เหลือ ${item.quantity})` });
        }

        // คำนวณราคารวมของที่เบิกไป (จำนวน x ราคาต่อชิ้น)
        const totalCost = item.price * qty;

        // คำนวณสต็อกใหม่
        const newStockQty = type === 'OUT' ? item.quantity - qty : item.quantity + qty;
        
        // ใช้ prisma.$transaction เพื่อสั่งให้อัปเดตสต็อกและบันทึกประวัติ "พร้อมกัน" ถ้าอันใดอันนึงพัง จะได้ยกเลิกทั้งหมด
        const result = await prisma.$transaction([
            prisma.item.update({
                where: { id: item.id },
                data: { quantity: newStockQty }
            }),
            prisma.transaction.create({
                data: {
                    type: type,
                    quantity: qty,
                    totalCost: totalCost,
                    itemId: item.id,
                    empId: empId,
                    projectId: projectId ? parseInt(projectId) : null
                }
            })
        ]);

        res.json({ success: true, message: "ทำรายการสำเร็จ", transaction: result[1] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการทำรายการ" });
    }
});

// API: ดึงประวัติการเบิก/รับของทั้งหมด
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            include: { 
                item: true,      // ขอข้อมูลรายละเอียดของชิ้นนั้นมาด้วย
                project: true,   // ขอชื่อโปรเจกต์มาด้วย
                employee: true   // ขอชื่อคนเบิกมาด้วย
            },
            orderBy: { createdAt: 'desc' } // เรียงจากล่าสุดไปเก่าสุด
        });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: "ไม่สามารถดึงประวัติได้" });
    }
});
// ==========================================


// --- วิธีแก้สำหรับ Express 5: ใช้ middleware ดักท้ายสุดแทนการใช้ app.get('*') ---
// วิธีนี้จะไม่ใช้เครื่องหมายดาว ทำให้ระบบไม่พ่น Error เรื่อง Path ออกมาครับ
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Server running on port ${PORT}`));