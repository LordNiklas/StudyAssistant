const express = require('express');
const router = express.Router();
const { getTopicPriority } = require('../controllers/explainController');

// GET /api/explain/topic-priority/:subjectId
router.get('/topic-priority/:subjectId', async (req, res) => {
  try {
    const { subjectId } = req.params;
    const data = await getTopicPriority(subjectId, req.session.userId);

    if (data === null) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }

    if (data === 'forbidden') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('explainRoutes error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
