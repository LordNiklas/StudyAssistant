const express = require('express');
const router = express.Router();
const upload = require('../utils/fileUpload');
const {
  uploadDocument,
  getSubjectDocuments,
  getDocument,
  deleteDocument,
  searchDocuments
} = require('../controllers/documentController');

// Search documents
router.get('/search', searchDocuments);

// Get all documents for a subject
router.get('/subject/:subjectId', getSubjectDocuments);

// Upload document to a subject (with file upload middleware and error handler)
router.post('/:subjectId', 
  (req, res, next) => {
    console.log('Starting file upload process...');
    console.log(`Request received for subject ID: ${req.params.subjectId}`);
    console.log('Request headers:', req.headers);
    
    // Check if content-type includes multipart/form-data
    if (!req.headers['content-type'] || !req.headers['content-type'].includes('multipart/form-data')) {
      console.error('Invalid content-type for file upload:', req.headers['content-type']);
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: 'File uploads require multipart/form-data content type'
      });
    }
    
    next();
  },
  upload.single('file'),
  upload.errorHandler, // Use the custom error handler
  uploadDocument
);

// Get or delete a specific document
router
  .route('/:id')
  .get(getDocument)
  .delete(deleteDocument);

// Log middleware configuration
console.log('Document routes configured with enhanced error handling');

module.exports = router;