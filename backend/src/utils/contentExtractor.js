const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

/**
 * Extract text content from a file based on its type
 * @param {string} filePath - Path to the file
 * @param {string} fileType - Type of the file (txt, docx, pdf)
 * @returns {Promise<string>} - Extracted text content
 */
const extractContent = async (filePath, fileType) => {
  console.log(`Starting content extraction for file: ${filePath}, type: ${fileType}`);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    const errorMsg = `File does not exist at path: ${filePath}`;
    console.error(errorMsg);
    return `[CONTENT EXTRACTION FAILED: ${errorMsg}]`;
  }
  
  try {
    // Check file size
    const stats = fs.statSync(filePath);
    console.log(`File size: ${stats.size} bytes`);
    
    if (stats.size === 0) {
      const errorMsg = 'File is empty (0 bytes)';
      console.error(errorMsg);
      return `[CONTENT EXTRACTION FAILED: ${errorMsg}]`;
    }
    
    // Normalize file type to lowercase
    const normalizedType = fileType.toLowerCase();
    console.log(`Processing file as type: ${normalizedType}`);
    
    let result;
    switch (normalizedType) {
      case 'txt':
        result = await extractFromTxt(filePath);
        break;
      case 'docx':
        result = await extractFromDocx(filePath);
        break;
      case 'pdf':
        result = await extractFromPdf(filePath);
        break;
      default:
        const errorMsg = `Unsupported file type: ${fileType}`;
        console.error(errorMsg);
        return `[UNSUPPORTED FILE TYPE: ${fileType}]`;
    }
    
    console.log(`Content extraction successful. Extracted ${result.length} characters`);
    return result;
  } catch (error) {
    console.error(`Error extracting content:`, error);
    console.error(`Error details: ${error.name}: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    
    // Return a detailed error message instead of throwing the error
    return `[CONTENT EXTRACTION FAILED: ${error.name}: ${error.message}]`;
  }
};

/**
 * Extract text from a .txt file
 * @param {string} filePath - Path to the .txt file
 * @returns {Promise<string>} - Extracted text content
 */
const extractFromTxt = async (filePath) => {
  console.log(`Extracting content from TXT file: ${filePath}`);
  try {
    const content = await new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          console.error(`Error reading TXT file: ${err.message}`);
          reject(err);
        } else {
          console.log(`Successfully read TXT file, content length: ${data.length} characters`);
          resolve(data);
        }
      });
    });
    
    // Validate content
    if (!content || content.trim().length === 0) {
      const errorMsg = 'TXT file is empty or contains only whitespace';
      console.error(errorMsg);
      return `[TXT CONTENT EXTRACTION FAILED: ${errorMsg}]`;
    }
    
    return content;
  } catch (error) {
    console.error(`Error extracting from TXT:`, error);
    console.error(`Error details: ${error.name}: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    // Return a detailed error message instead of throwing the error
    return `[TXT CONTENT EXTRACTION FAILED: ${error.name}: ${error.message}]`;
  }
};

/**
 * Extract text from a .docx file
 * @param {string} filePath - Path to the .docx file
 * @returns {Promise<string>} - Extracted text content
 */
const extractFromDocx = async (filePath) => {
  console.log(`Extracting content from DOCX file: ${filePath}`);
  try {
    console.log('Using mammoth.js to extract DOCX content');
    const result = await mammoth.extractRawText({ path: filePath });
    
    // Check for warnings
    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX extraction warnings:', result.messages);
    }
    
    // Validate content
    if (!result.value || result.value.trim().length === 0) {
      const errorMsg = 'DOCX file is empty or contains only whitespace';
      console.error(errorMsg);
      return `[DOCX CONTENT EXTRACTION FAILED: ${errorMsg}]`;
    }
    
    console.log(`Successfully extracted DOCX content, length: ${result.value.length} characters`);
    return result.value;
  } catch (error) {
    console.error(`Error extracting from DOCX:`, error);
    console.error(`Error details: ${error.name}: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    // Return a detailed error message instead of throwing the error
    return `[DOCX CONTENT EXTRACTION FAILED: ${error.name}: ${error.message}]`;
  }
};

/**
 * Extract text from a .pdf file
 * @param {string} filePath - Path to the .pdf file
 * @returns {Promise<string>} - Extracted text content
 */
const extractFromPdf = async (filePath) => {
  console.log(`Extracting content from PDF file: ${filePath}`);
  try {
    console.log('Reading PDF file into buffer');
    const dataBuffer = fs.readFileSync(filePath);
    
    if (!dataBuffer || dataBuffer.length === 0) {
      const errorMsg = 'PDF file buffer is empty';
      console.error(errorMsg);
      return `[PDF CONTENT EXTRACTION FAILED: ${errorMsg}]`;
    }
    
    console.log(`PDF buffer size: ${dataBuffer.length} bytes`);
    console.log('Parsing PDF content with pdf-parse');
    
    const options = {
        max: 0, // Process all pages
    };
    const data = await pdfParse(dataBuffer, options);
    
    // Validate content
    if (!data.text || data.text.trim().length === 0) {
      const errorMsg = 'PDF file is empty or contains only whitespace';
      console.error(errorMsg);
      return `[PDF CONTENT EXTRACTION FAILED: ${errorMsg}]`;
    }
    
    console.log(`Successfully extracted PDF content, length: ${data.text.length} characters`);
    console.log(`PDF metadata: ${data.info ? JSON.stringify(data.info) : 'None'}`);
    
    return data.text;
  } catch (error) {
    console.error(`Error extracting from PDF:`, error);
    console.error(`Error details: ${error.name}: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    // Return a detailed error message instead of throwing the error
    return `[PDF CONTENT EXTRACTION FAILED: ${error.name}: ${error.message}]`;
  }
};

module.exports = {
  extractContent
};