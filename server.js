require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const winston = require('winston');
const NodeCache = require('node-cache');
const { searchUSATFDatabase, findCoursePDF, extractPDFData } = require('./services/courseService');

const app = express();

// Configuration
const config = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  CACHE_TTL: parseInt(process.env.CACHE_TTL) || 3600,
  MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '10mb',
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
};

// Logging configuration - simplified for now
const logger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || '')
};

// Cache configuration
const cache = new NodeCache({ stdTTL: config.CACHE_TTL });

// Security middleware with CSP that allows inline scripts for our app
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://certifiedroadraces.com"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration - permissive for now
app.use(cors());

// Rate limiting with reasonable limits
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' // Skip rate limiting for localhost
});
app.use('/api/', limiter);

// Compression and body parsing
app.use(compression());
app.use(express.json({ limit: config.MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_REQUEST_SIZE }));

// Serve main HTML files BEFORE static middleware
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Static file serving with caching
app.use(express.static('public', {
  maxAge: config.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true
}));

app.get('/viewer.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer.html'));
});

// API Routes
app.post('/api/search-courses', async (req, res) => {
  try {
    const searchParams = req.body;
    const { useCache = true } = req.body;
    
    // Validate that we have at least one search parameter
    if (!searchParams.city && !searchParams.state && !searchParams.courseId && !searchParams.courseName) {
      return res.status(400).json({ error: 'At least one search parameter is required' });
    }

    // Create cache key from search parameters
    const cacheKey = `search-${JSON.stringify(searchParams)}`;
    
    // Check cache first
    if (useCache) {
      const cachedResult = cache.get(cacheKey);
      if (cachedResult) {
        console.log(`Cache hit for search parameters`);
        return res.json(cachedResult);
      }
    }

    console.log('Searching for courses with parameters:', searchParams);
    
    // Search USATF database
    const courses = await searchUSATFDatabase(searchParams);
    
    if (!courses || courses.length === 0) {
      const result = { 
        courses: [], 
        message: 'No courses found matching your criteria',
        searchParams 
      };
      cache.set(cacheKey, result);
      return res.json(result);
    }

    // Find PDFs for each course
    const coursesWithPDFs = await Promise.all(
      courses.map(async (course) => {
        try {
          console.log(`Looking for PDF for course: ${course.id} - ${course.name}`);
          const pdfInfo = await findCoursePDF(course);
          
          if (pdfInfo && pdfInfo.pdfPath) {
            // Extract PDF data using Python scripts
            const extractedData = await extractPDFData(pdfInfo.pdfPath);
            return {
              ...course,
              pdfUrl: `/api/pdf/${encodeURIComponent(path.basename(pdfInfo.pdfPath))}`,
              pdfPath: pdfInfo.pdfPath,
              extractedData: extractedData || {}
            };
          }
          
          return course;
        } catch (error) {
          console.error(`Error processing course ${course.id}:`, error.message);
          return course;
        }
      })
    );

    const result = { 
      courses: coursesWithPDFs, 
      message: `Found ${coursesWithPDFs.length} course${coursesWithPDFs.length !== 1 ? 's' : ''}`,
      searchParams
    };
    
    // Cache the result
    cache.set(cacheKey, result);
    
    res.json(result);
    
  } catch (error) {
    logger.error('Search error:', { error: error.message, stack: error.stack, searchParams });
    res.status(500).json({ 
      error: 'Failed to search courses',
      details: config.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Serve PDF files with security checks
app.get('/api/pdf/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Security: Validate filename to prevent path traversal
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn(`Invalid PDF filename requested: ${filename}`);
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    // Additional security: Only allow specific file extensions
    if (!filename.toLowerCase().endsWith('.pdf')) {
      logger.warn(`Non-PDF file requested: ${filename}`);
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }
    
    const pdfPath = path.join(__dirname, 'downloads', filename);
    
    // Ensure the resolved path is within the downloads directory
    const resolvedPath = path.resolve(pdfPath);
    const downloadsDir = path.resolve(__dirname, 'downloads');
    if (!resolvedPath.startsWith(downloadsDir)) {
      logger.warn(`Path traversal attempt detected: ${filename}`);
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(pdfPath)) {
      logger.info(`PDF not found: ${filename}`);
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(pdfPath);
    
    logger.info(`PDF served: ${filename}`);
    
  } catch (error) {
    logger.error('PDF serve error:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Get available states for dropdown
app.get('/api/states', (req, res) => {
  const states = [
    { code: 'AL', name: 'Alabama' },
    { code: 'AK', name: 'Alaska' },
    { code: 'AZ', name: 'Arizona' },
    { code: 'AR', name: 'Arkansas' },
    { code: 'CA', name: 'California' },
    { code: 'CO', name: 'Colorado' },
    { code: 'CT', name: 'Connecticut' },
    { code: 'DE', name: 'Delaware' },
    { code: 'FL', name: 'Florida' },
    { code: 'GA', name: 'Georgia' },
    { code: 'HI', name: 'Hawaii' },
    { code: 'ID', name: 'Idaho' },
    { code: 'IL', name: 'Illinois' },
    { code: 'IN', name: 'Indiana' },
    { code: 'IA', name: 'Iowa' },
    { code: 'KS', name: 'Kansas' },
    { code: 'KY', name: 'Kentucky' },
    { code: 'LA', name: 'Louisiana' },
    { code: 'ME', name: 'Maine' },
    { code: 'MD', name: 'Maryland' },
    { code: 'MA', name: 'Massachusetts' },
    { code: 'MI', name: 'Michigan' },
    { code: 'MN', name: 'Minnesota' },
    { code: 'MS', name: 'Mississippi' },
    { code: 'MO', name: 'Missouri' },
    { code: 'MT', name: 'Montana' },
    { code: 'NE', name: 'Nebraska' },
    { code: 'NV', name: 'Nevada' },
    { code: 'NH', name: 'New Hampshire' },
    { code: 'NJ', name: 'New Jersey' },
    { code: 'NM', name: 'New Mexico' },
    { code: 'NY', name: 'New York' },
    { code: 'NC', name: 'North Carolina' },
    { code: 'ND', name: 'North Dakota' },
    { code: 'OH', name: 'Ohio' },
    { code: 'OK', name: 'Oklahoma' },
    { code: 'OR', name: 'Oregon' },
    { code: 'PA', name: 'Pennsylvania' },
    { code: 'RI', name: 'Rhode Island' },
    { code: 'SC', name: 'South Carolina' },
    { code: 'SD', name: 'South Dakota' },
    { code: 'TN', name: 'Tennessee' },
    { code: 'TX', name: 'Texas' },
    { code: 'UT', name: 'Utah' },
    { code: 'VT', name: 'Vermont' },
    { code: 'VA', name: 'Virginia' },
    { code: 'WA', name: 'Washington' },
    { code: 'WV', name: 'West Virginia' },
    { code: 'WI', name: 'Wisconsin' },
    { code: 'WY', name: 'Wyoming' },
    { code: 'DC', name: 'District of Columbia' }
  ];
  
  res.json(states);
});

// Cache management endpoints
app.get('/api/cache/stats', (req, res) => {
  const stats = cache.getStats();
  res.json({
    ...stats,
    keys: cache.keys()
  });
});

app.delete('/api/cache/clear', (req, res) => {
  cache.flushAll();
  res.json({ message: 'Cache cleared' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', { 
    error: error.message, 
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: config.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found' });
});

// Create downloads directory if it doesn't exist
fs.ensureDirSync(path.join(__dirname, 'downloads'));

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(config.PORT, () => {
  logger.info(`Race Course Finder server running on http://localhost:${config.PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  logger.info(`Allowed origins: ${config.ALLOWED_ORIGINS.join(', ')}`);
});