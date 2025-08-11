const db = require('../db');

const products = [
  { name: 'Điếu cày tre truyền thống', description: 'Điếu cày tre, âm êm, cột đồng chắc chắn.', price: 150000, stock: 20, image: '/img/dieu-cay-tre.jpg' },
  { name: 'Điếu cày inox mini', description: 'Gọn nhẹ, dễ vệ sinh, phù hợp mang theo.', price: 220000, stock: 15, image: '/img/dieu-cay-inox.jpg' },
  { name: 'Thuốc lào Tiên Lãng 100g', description: 'Vị đậm, hương thơm đặc trưng.', price: 90000, stock: 40, image: '/img/thuoc-lao-100g.jpg' },
  { name: 'Thuốc lào Quảng Trị 200g', description: 'Hậu vị mạnh, phù hợp khách quen.', price: 170000, stock: 30, image: '/img/thuoc-lao-200g.jpg' }
];

db.serialize(()=>{
  const stmt = db.prepare('INSERT INTO products (name, description, price, stock, image) VALUES (?, ?, ?, ?, ?)');
  products.forEach(p => stmt.run([p.name, p.description, p.price, p.stock, p.image]));
  stmt.finalize(()=>{
    console.log('Seed xong sản phẩm.');
    process.exit(0);
  });
});
