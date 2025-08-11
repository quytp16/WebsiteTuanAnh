const bcrypt = require('bcrypt');
const db = require('../db');

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'changeme123';

(async () => {
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)', [username, hash], (err)=>{
    if (err) console.error(err);
    else console.log(`Tạo admin thành công: ${username}/${password}`);
    process.exit(0);
  });
})();
