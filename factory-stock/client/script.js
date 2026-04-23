// script.js
// ข้อมูลหมวดหมู่จำลอง (Mock Data)
const mockCategories = [
    { name: "ติดตั้งบูธ/Booth Setup", image: "booth.png" }, // ใช้ชื่อไฟล์รูปที่จะสร้าง
    { name: "งานเหล็ก/iron work", image: "iron.png" },
    { name: "งานสติ้กเกอร์/Sticker", image: "sticker.png" },
    { name: "แพคกิ้ง/packing", image: "packing.png" },
    { name: "งานสี/Painting", image: "painting.png" },
    { name: "ขนส่ง พรบ./CTP", image: "ctp.png" },
    { name: "งานไม้/Woodworking", image: "wood.png" }
];

// ฟังก์ชันโหลดหมวดหมู่จำลอง
function loadCategories() {
    const categoryGrid = document.getElementById('categoryGrid');
    mockCategories.forEach(category => {
        const cardHTML = `
            <div class="category-card">
                <img src="${category.image}" alt="${category.name}">
                <h3>${category.name}</h3>
            </div>
        `;
        categoryGrid.innerHTML += cardHTML;
    });
}

// สั่งให้โหลดหมวดหมู่ทันทีเมื่อเปิดหน้าเว็บ
loadCategories();