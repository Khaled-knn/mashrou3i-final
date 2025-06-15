const crypto = require('crypto');

function generateToken(length = 40) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = generateToken;
