const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'srv1702.hstgr.io',
  user: 'u200369391_mashru3i',
  password: 'DevL00pMint123$$$',
  database: 'u200369391_mashrou3i2',
});

connection.connect((err) => {
  if (err) {
    return console.error('❌ Error connecting:', err.message);
  }
  console.log('✅ Connected to MySQL!');
  connection.end();
});
