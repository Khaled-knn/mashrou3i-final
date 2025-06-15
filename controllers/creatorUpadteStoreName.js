const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/authMiddleware');

router.post('/creator/update-name', protect, async (req, res) => {
  const newName = req.body.name;
  const cost = 5;

  console.log('req.user in update-name:', JSON.stringify(req.user)); 
  console.log('req.body:', JSON.stringify(req.body)); 

  const creatorId = req.user ? req.user.id : 'CREATOR_ID_UNDEFINED';
  console.log('creatorId from token:', creatorId);

  console.log('About to query tokens for creatorId:', creatorId);

  try {
    if (creatorId === 'CREATOR_ID_UNDEFINED') {
      return res.status(401).json({ error: 'Unauthorized: Creator ID not found in token.' });
    }

    const [coinsRows] = await db.execute(
      'SELECT tokens FROM creators WHERE id = ?',
      [creatorId]
    );

    console.log('coinsRows:', JSON.stringify(coinsRows));

    if (coinsRows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    const currentCoins = coinsRows[0].tokens;
    console.log('currentCoins:', currentCoins, 'cost:', cost);

    const finalNewName = newName !== undefined ? newName : 'NEW_NAME_UNDEFINED'; 
    console.log('Values before UPDATE - newName:', finalNewName, 'creatorId:', creatorId);

    await db.execute(
      'UPDATE creators SET store_name = ?, tokens = ? WHERE id = ?',
      [finalNewName, currentCoins - cost, creatorId]
    );

    res.status(200).json({ message: 'Name updated successfully', newName: finalNewName, remainingCoins: currentCoins - cost });

  } catch (error) {
    console.error('Error updating name:', error);
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;