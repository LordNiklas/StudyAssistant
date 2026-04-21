const express = require('express');
const router = express.Router();
const {
  generateQuestions,
  submitAssessment,
  getHistory,
  getErrorPatterns,
  getSession,
  getLatestSessions,
  generateLearningPlan,
  getGuidedLearningRoute,
  updateGuidedLearningProgress,
  generateGuidedFlashcards,
  getPostExamCatalog,
  submitPostExamReview,
  getPostExamHistory,
  getPostExamReviewBySession,
  getLearningProfile,
  updateLearningProfile,
  getQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getFlashcards,
  getFlashcardStats,
  createFlashcard,
  updateFlashcard,
  archiveFlashcard,
  generateFlashcards,
  submitFlashcardReview
} = require('../controllers/assessmentController');

// Routes for /api/assessment

// Global learning profile
router.get('/learning-profile', getLearningProfile);
router.put('/learning-profile', updateLearningProfile);

// Generate questions for a subject
router.get('/generate/:subjectId', generateQuestions);

// Submit assessment answers
router.post('/submit', submitAssessment);

// Get assessment history for a subject
router.get('/history/:subjectId', getHistory);

// Get error patterns for a subject
router.get('/errors/:subjectId', getErrorPatterns);

// Get full session detail
router.get('/session/:sessionId', getSession);

// Get latest session per subject (for the subjects overview dashboard)
router.get('/latest-sessions', getLatestSessions);

// Generate a personalised learning plan
router.post('/learning-plan/:subjectId', generateLearningPlan);

// Guided learning journey
router.get('/guided-learning/:subjectId', getGuidedLearningRoute);
router.post('/guided-learning/:subjectId/progress', updateGuidedLearningProgress);
  router.post('/guided-learning/:subjectId/flashcards/:step', generateGuidedFlashcards);

// Post-exam re-check
router.get('/post-exam/catalog/:subjectId', getPostExamCatalog);
router.post('/post-exam/submit', submitPostExamReview);
router.get('/post-exam/history/:subjectId', getPostExamHistory);
router.get('/post-exam/session/:sessionId', getPostExamReviewBySession);

// Flashcards with spaced repetition
router.post('/flashcards/review', submitFlashcardReview);
router.get('/flashcards/stats/:subjectId', getFlashcardStats);
router.get('/flashcards/:subjectId', getFlashcards);
router.post('/flashcards/:subjectId', createFlashcard);
router.put('/flashcards/:cardId', updateFlashcard);
router.delete('/flashcards/:cardId', archiveFlashcard);
router.post('/flashcards/generate/:subjectId', generateFlashcards);

// Hybrid question management
router.get('/questions/:subjectId', getQuestions);
router.post('/questions/:subjectId', createQuestion);
router.put('/questions/:questionId', updateQuestion);
router.delete('/questions/:questionId', deleteQuestion);

module.exports = router;
