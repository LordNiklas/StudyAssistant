const { Document, Subject, AssessmentQuestion } = require('../models/pgModels');
const { extractContent } = require('../utils/contentExtractor');
const { storeDocumentVector, deleteDocumentVector, searchSimilarDocuments } = require('../utils/vectorDb');
const path = require('path');
const fs = require('fs');

// @desc    Upload document to a subject
// @route   POST /api/documents/:subjectId
// @access  Public
exports.uploadDocument = async (req, res) => {
  try {
    console.log('Starting document upload process...');
    
    // Check if subject exists and belongs to the user
    console.log(`Looking for subject with ID: ${req.params.subjectId}`);
    const subject = await Subject.findById(req.params.subjectId);
    if (!subject) {
      console.error(`Subject not found with ID: ${req.params.subjectId}`);
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }
    // Only owner can upload documents
    if (String(subject.user_id) !== String(req.session.userId)) {
      console.error(`Unauthorized upload attempt for subject ${subject.id}. Subject owner: ${subject.user_id}, User: ${req.session.userId}`);
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized',
        message: 'Only the subject owner can upload documents'
      });
    }
    console.log(`Subject found: ${subject.name}`);

    // Check if file was uploaded
    if (!req.file) {
      console.error('No file was uploaded in the request');
      return res.status(400).json({
        success: false,
        error: 'Please upload a file'
      });
    }

    // Get file details
    const file = req.file;
    console.log(`File received: ${file.originalname}, size: ${file.size} bytes, path: ${file.path}`);
    const fileType = path.extname(file.originalname).substring(1); // Remove the dot
    console.log(`File type detected: ${fileType}`);
    
    // Extract content from file
    console.log(`Extracting content from ${fileType} file...`);
    const content = await extractContent(file.path, fileType);
    console.log(`Content extraction complete. Content length: ${content.length} characters`);
    
    // Check if content extraction failed
    if (content.includes('[CONTENT EXTRACTION FAILED') || 
        content.includes('[TXT CONTENT EXTRACTION FAILED') || 
        content.includes('[DOCX CONTENT EXTRACTION FAILED') || 
        content.includes('[PDF CONTENT EXTRACTION FAILED')) {
      console.error(`Content extraction failed: ${content}`);
    }
    
    // Create document in database
    console.log('Creating document record in database...');
    const document = await Document.create({
      name: req.body.name || file.originalname,
      originalFilename: file.originalname,
      fileType: fileType,
      filePath: file.path,
      content: content,
      subject: subject.id
    });
    console.log(`Document created in database with ID: ${document.id}`);
    
    let indexingWarning = null;

    // Store document vector in PostgreSQL
    console.log('Storing document vector in PostgreSQL...');
    try {
      const vectorId = await storeDocumentVector(
        document.id.toString(),
        content,
        subject.id.toString()
      );
      
      // Update document with vector ID
      document.vectorId = vectorId;
      await Document.save(document);
      console.log(`Vector stored successfully with ID: ${vectorId}`);
    } catch (vectorError) {
      console.error('Error storing document vector:', vectorError);
      console.error('Vector storage failed, but document was created in database');
      indexingWarning = 'Dokument wurde gespeichert, aber die Vektor-Indizierung ist fehlgeschlagen. Die Suche kann vorübergehend ungenau sein.';
    }
    
    // Add document to subject's documents array
    console.log(`Adding document to subject's documents array...`);
    await Subject.addDocument(subject.id, document.id);
    console.log('Document added to subject successfully');
    
    // Invalidate cached assessment questions for this subject
    console.log('Invalidating cached assessment questions...');
    try {
      await AssessmentQuestion.deleteBySubject(subject.id, req.session.userId);
      console.log('Assessment question cache invalidated');
    } catch (cacheError) {
      console.error('Failed to invalidate question cache:', cacheError);
      // Non-critical, continue
    }
    
    res.status(201).json({
      success: true,
      data: document,
      warning: indexingWarning
    });
    console.log('Document upload completed successfully');
  } catch (error) {
    console.error('Error uploading document:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Provide more specific error messages based on error type
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.message
      });
    } else if (error.name === 'MongoServerError' && error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate Error',
        details: 'A document with this name already exists'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Server Error',
        message: error.message
      });
    }
  }
};

// @desc    Get all documents for a subject
// @route   GET /api/documents/subject/:subjectId
// @access  Public
exports.getSubjectDocuments = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const documents = await Document.find({ subject: req.params.subjectId });

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    console.error('Error getting subject documents:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Get a single document
// @route   GET /api/documents/:id
// @access  Public
exports.getDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const subject = await Subject.findById(document.subject_id);
    if (!subject) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    console.error('Error getting document:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// @desc    Delete a document
// @route   DELETE /api/documents/:id
// @access  Public
exports.deleteDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const subject = await Subject.findById(document.subject_id);
    if (!subject || String(subject.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Remove document from subject's documents array
    await Subject.removeDocument(document.subject_id, document.id);
    
    // Delete document vector from PostgreSQL
    await deleteDocumentVector(document.id.toString());
    
    // Delete file from filesystem
    if (fs.existsSync(document.file_path)) {
      fs.unlinkSync(document.file_path);
    }
    
    // Delete document from database
    await Document.delete(document.id);
    
    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    // PostgreSQL doesn't have CastError, so we'll handle errors differently
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

// @desc    Search documents by content
// @route   GET /api/documents/search
// @access  Public
exports.searchDocuments = async (req, res) => {
  try {
    const { query, subjectId, limit = 5 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a search query'
      });
    }
    
    // Determine accessible subjects: own + subscribed
    const accessibleSubjects = await Subject.findAll('created_at', 'DESC', req.session.userId, 'all');
    const accessibleSubjectIds = new Set(accessibleSubjects.map(s => String(s.id)));

    // If a subject filter is provided, enforce access control before vector search
    if (subjectId && !accessibleSubjectIds.has(String(subjectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Search for similar documents in vector database
    const searchResults = await searchSimilarDocuments(
      query,
      subjectId || null,
      parseInt(limit)
    );
    
    if (!searchResults || searchResults.length === 0) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }
    
    // Get document IDs from search results
    const documentIds = searchResults.map(result => result.payload.document_id);

    // Get documents from PostgreSQL, filtered to subjects the user can access
    const documents = [];
    for (const id of documentIds) {
      const doc = await Document.findById(id);
      if (!doc) continue;
      if (!accessibleSubjectIds.has(String(doc.subject_id))) continue;
      documents.push(doc);
    }
    
    // Sort documents in the same order as search results
    const sortedDocuments = documentIds.map(id => 
      documents.find(doc => doc.id.toString() === id)
    ).filter(Boolean);
    
    res.status(200).json({
      success: true,
      count: sortedDocuments.length,
      data: sortedDocuments
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};