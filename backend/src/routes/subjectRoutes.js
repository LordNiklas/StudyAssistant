const express = require('express');
const router = express.Router();
const {
  getSubjects,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
  classifySubject,
  generateProfessorRequestTemplate,
  getPublicSubjects,
  subscribeToSubject,
  unsubscribeFromSubject,
  getMySubscriptions,
  getSubjectSubscribers,
} = require('../controllers/subjectController');

// Routes for /api/subjects
router
  .route('/')
  .get(getSubjects)
  .post(createSubject);

// Subscription routes (static routes must be registered before /:id)
router.get('/public/list', getPublicSubjects);
router.get('/subscriptions/mine', getMySubscriptions);

// Routes for /api/subjects/:id
router
  .route('/:id')
  .get(getSubject)
  .put(updateSubject)
  .delete(deleteSubject);

router.get('/:id/classify', classifySubject);
router.post('/:id/request-template', generateProfessorRequestTemplate);
router.post('/:id/subscribe', subscribeToSubject);
router.post('/:id/unsubscribe', unsubscribeFromSubject);
router.get('/:id/subscribers', getSubjectSubscribers);

module.exports = router;