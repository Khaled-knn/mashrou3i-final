const express = require('express');
const router = express.Router();
const pool = require('../config/db');

function parseTime(timeStr) {
  const [hour, minute] = timeStr.split(':').map(Number);
  return { hour, minute };
}

function isOfferActive(offer) {
  const now = new Date();
  const start = new Date(offer.start);
  const end = new Date(offer.end);
  return now >= start && now <= end;
}

router.get('/byProfessionId/:professionId', async (req, res) => {
  try {
    const { professionId } = req.params;
    const { search, minRate, freeDelivery, hasOffer, isOpenNow } = req.query;

    const [creators] = await pool.query(`
      SELECT 
        id,
        CONCAT(first_name, ' ', last_name) AS full_name,
        profile_image,
        cover_photo,
        store_name,
        deliveryValue,
        rate
      FROM creators
      WHERE profession_id = ?
        AND status = 'approved'
        ${search ? `AND (first_name LIKE ? OR last_name LIKE ? OR store_name LIKE ?)` : ''}
        ${minRate ? `AND rate >= ?` : ''}
    `, [
      professionId,
      ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []),
      ...(minRate ? [minRate] : []),
    ]);

    if (creators.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const creatorIds = creators.map(c => c.id);

    const [offers] = await pool.query(`SELECT * FROM creator_offers WHERE creator_id IN (?)`, [creatorIds]);
    const [paymentMethods] = await pool.query(`SELECT * FROM creator_payment_methods WHERE creator_id IN (?)`, [creatorIds]);
    const [availability] = await pool.query(`SELECT * FROM creator_availability WHERE creator_id IN (?)`, [creatorIds]);
    const [addresses] = await pool.query(`SELECT creator_id, city, country ,street FROM addresses WHERE creator_id IN (?)`, [creatorIds]);
    const [rates] = await pool.query(`
  SELECT creator_id, COUNT(*) AS rate_count, ROUND(AVG(rating), 2) AS average_rate
  FROM creator_reviews
  WHERE creator_id IN (?)
  GROUP BY creator_id
`, [creatorIds]);

    const getRateCount = (creatorId) =>
      rates.find(r => r.creator_id === creatorId)?.rate_count || 0;

    const getAverageRate = (creatorId) =>
      rates.find(r => r.creator_id === creatorId)?.average_rate?.toFixed(2) || '0.00';

    // دمج البيانات
    let result = creators.map(creator => {
      const address = addresses.find(a => a.creator_id === creator.id);

      const creatorOffers = offers
        .filter(o => o.creator_id === creator.id)
        .map(o => ({
          type: o.offer_type,
          value: o.offer_value,
          start: o.offer_start,
          end: o.offer_end,
        }));

      const creatorAvailability = availability
        .filter(a => a.creator_id === creator.id)
        .map(a => ({
          type: a.type,
          open_at: a.open_at,
          close_at: a.close_at,
          days: a.days ? JSON.parse(a.days) : null,
        }));

      return {
        id: creator.id,
        full_name: creator.full_name,
        profile_image: creator.profile_image,
        cover_photo: creator.cover_photo,
        store_name: creator.store_name,
        deliveryValue: creator.deliveryValue,
        rate: getAverageRate(creator.id),
        rate_count: getRateCount(creator.id), // ✅ عدد التقييمات
        address: address
          ? {
            city: address.city,
            street: address.street,
            country: address.country,
          }
          : null,
        offers: creatorOffers,
        payment_methods: paymentMethods
          .filter(p => p.creator_id === creator.id)
          .map(p => ({
            method: p.method,
            account_info: p.account_info,
          })),
        availability: creatorAvailability,
      };
    });

    // فلترة حسب التوصيل المجاني
    if (freeDelivery === 'true') {
      result = result.filter(c =>
        c.offers.some(o => o.type === 'free_delivery' && isOfferActive(o))
      );
    }

    // فلترة حسب العروض العامة
    if (hasOffer === 'true') {
      result = result.filter(c =>
        c.offers.some(o => o.type === 'discount_all_orders' && isOfferActive(o))
      );
    }

    // فلترة حسب التوفر حالياً
    if (isOpenNow === 'true') {
      const now = new Date();
      const currentDay = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      result = result.filter(c =>
        c.availability.some(a => {
          const open = parseTime(a.open_at);
          const close = parseTime(a.close_at);
          const openMins = open.hour * 60 + open.minute;
          const closeMins = close.hour * 60 + close.minute;

          if (!a.days || a.days.length === 0) return true; // مفتوح يومياً
          return a.days.includes(currentDay) &&
            currentMinutes >= openMins &&
            currentMinutes < closeMins;
        })
      );
    }

    res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
