const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = './uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`Created uploads directory at ${path.resolve(uploadDir)}`);
}

// Set storage engine with enhanced logging
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    console.log(`Setting destination for file upload: ${path.resolve(uploadDir)}`);
    
    // Check if directory is writable
    try {
      fs.accessSync(uploadDir, fs.constants.W_OK);
      console.log('Uploads directory is writable');
    } catch (error) {
      console.error(`Uploads directory is not writable: ${error.message}`);
      return cb(new Error(`Cannot write to uploads directory: ${error.message}`));
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Use a unique filename: timestamp + original name
    const filename = `${Date.now()}-${file.originalname}`;
    console.log(`Generated filename for upload: ${filename}`);
    cb(null, filename);
  }
});

// Check file type with enhanced logging
const fileFilter = (req, file, cb) => {
  console.log(`Validating file: ${file.originalname}, mimetype: ${file.mimetype}`);
  
  // Allowed file extensions
  const filetypes = /txt|docx|pdf/;
  
  // Check extension
  const extension = path.extname(file.originalname).toLowerCase();
  const extname = filetypes.test(extension);
  
  // Check mime type
  const mimetype = file.mimetype;
  const validMimeTypes = [
    'text/plain',                     // txt
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/pdf'                 // pdf
  ];
  
  if (!extname) {
    const errorMsg = `Invalid file extension: ${extension}. Only .txt, .docx, and .pdf files are allowed!`;
    console.error(errorMsg);
    return cb(new Error(errorMsg), false);
  }
  
  if (!validMimeTypes.includes(mimetype)) {
    const errorMsg = `Invalid mimetype: ${mimetype}. Only text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document, and application/pdf are allowed!`;
    console.error(errorMsg);
    return cb(new Error(errorMsg), false);
  }
  
  console.log(`File validation passed for ${file.originalname}`);
  return cb(null, true);
};

// Custom error handling for multer
const multerErrorHandler = (err, req, res, next) => {
  if (err) {
    console.error('Multer error during file upload:', err);
    
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File too large',
          details: 'File size exceeds the 10MB limit'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'File upload error',
        details: err.message
      });
    }
    
    // For other errors
    return res.status(400).json({
      success: false,
      error: 'File validation error',
      details: err.message
    });
  }
  
  // If no error, continue
  next();
};

// Initialize upload with enhanced logging
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  fileFilter: fileFilter
});

console.log('File upload middleware configured with 10MB size limit');

// Export both the upload middleware and the error handler
module.exports = upload;
module.exports.errorHandler = multerErrorHandler;