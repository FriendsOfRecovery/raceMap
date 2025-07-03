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
const axios = require('axios');
const { searchUSATFDatabase, findCoursePDF, extractPDFData } = require('./services/courseService');
const cacheService = require('./services/cacheService');

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

    // Find PDFs for each course with caching
    const coursesWithPDFs = await Promise.all(
      courses.map(async (course) => {
        try {
          // First check if we have cached course data (including PDF info)
          const cachedCourse = cacheService.getCourseCache(course.id);
          if (cachedCourse) {
            console.log(`Cache hit for course: ${course.id} - using cached data`);
            return {
              ...course,
              ...cachedCourse
            };
          }

          console.log(`Looking for PDF for course: ${course.id} - ${course.name}`);
          const pdfInfo = await findCoursePDF(course);
          
          let courseWithPDF = { ...course };
          
          if (pdfInfo && pdfInfo.pdfPath) {
            // Extract PDF data using Python scripts (this will check its own cache)
            const extractedData = await extractPDFData(pdfInfo.pdfPath);
            courseWithPDF = {
              ...course,
              pdfUrl: `/api/pdf/${encodeURIComponent(path.basename(pdfInfo.pdfPath))}`,
              pdfPath: pdfInfo.pdfPath,
              extractedData: extractedData || {}
            };
          }
          
          // Cache the complete course data
          cacheService.setCourseCache(course.id, {
            pdfUrl: courseWithPDF.pdfUrl,
            pdfPath: courseWithPDF.pdfPath,
            extractedData: courseWithPDF.extractedData
          });
          
          return courseWithPDF;
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

// Geocoding endpoint with caching
app.post('/api/geocode', async (req, res) => {
  try {
    const { city, state } = req.body;
    
    if (!city || !state) {
      return res.status(400).json({ error: 'City and state are required' });
    }
    
    // Check cache first
    const cachedCoords = cacheService.getGeocodingCache(city, state);
    if (cachedCoords) {
      return res.json({ 
        coordinates: cachedCoords,
        cached: true 
      });
    }
    
    // Geocode using Nominatim with rate limiting respect
    const query = `${city}, ${state}, United States`;
    
    try {
      // Add delay to respect rate limits and proper headers
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await axios.get(`https://nominatim.openstreetmap.org/search`, {
        params: {
          format: 'json',
          q: query,
          limit: 3,
          addressdetails: 1
        },
        headers: {
          'User-Agent': 'Race-Course-Finder/1.0 (contact@example.com)'
        },
        timeout: 5000
      });
      
      const data = response.data;
      
      if (data && data.length > 0) {
        // Filter for city/town/village results, avoid counties
        const cityResult = data.find(result => {
          const type = result.type;
          const addressType = result.addresstype;
          const displayName = result.display_name.toLowerCase();
          
          // Prefer cities, towns, villages over counties
          if (type === 'city' || type === 'town' || type === 'village' || 
              addressType === 'city' || addressType === 'town' || addressType === 'village') {
            return true;
          }
          
          // Avoid county results
          if (type === 'county' || addressType === 'county' || 
              displayName.includes('county')) {
            return false;
          }
          
          return true;
        });
        
        if (cityResult) {
          const coordinates = [parseFloat(cityResult.lat), parseFloat(cityResult.lon)];
          
          // Cache the result
          cacheService.setGeocodingCache(city, state, coordinates);
          
          return res.json({ 
            coordinates,
            cached: false,
            source: cityResult.display_name 
          });
        }
        
        // If no specific city found, use first non-county result
        const nonCountyResult = data.find(result => {
          const displayName = result.display_name.toLowerCase();
          return !displayName.includes('county');
        });
        
        if (nonCountyResult) {
          const coordinates = [parseFloat(nonCountyResult.lat), parseFloat(nonCountyResult.lon)];
          
          // Cache the result
          cacheService.setGeocodingCache(city, state, coordinates);
          
          return res.json({ 
            coordinates,
            cached: false,
            source: nonCountyResult.display_name 
          });
        }
      }
      
      // No results found
      logger.info(`No geocoding results for: ${city}, ${state}`);
      res.status(404).json({ error: 'Location not found' });
      
    } catch (error) {
      logger.warn(`Geocoding failed for ${city}, ${state}: ${error.message}`);
      res.status(404).json({ error: 'Geocoding service unavailable' });
    }
    
  } catch (error) {
    logger.error('Geocoding error:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Geocoding service error' });
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
  const memoryStats = cache.getStats();
  const persistentStats = cacheService.getCacheStats();
  
  res.json({
    memory: {
      ...memoryStats,
      keys: cache.keys()
    },
    persistent: persistentStats
  });
});

app.delete('/api/cache/clear', (req, res) => {
  cache.flushAll();
  cacheService.clearAllCaches();
  res.json({ message: 'All caches cleared' });
});

app.delete('/api/cache/clear/geocoding', (req, res) => {
  cacheService.geocodingCache = {};
  cacheService.saveCache(cacheService.geocodingCache, cacheService.geocodingCacheFile);
  res.json({ message: 'Geocoding cache cleared' });
});

app.delete('/api/cache/clear/pdf', (req, res) => {
  cacheService.pdfCache = {};
  cacheService.saveCache(cacheService.pdfCache, cacheService.pdfCacheFile);
  res.json({ message: 'PDF cache cleared' });
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