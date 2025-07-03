const fs = require('fs-extra');
const path = require('path');

class CacheService {
  constructor() {
    this.cacheDir = path.join(__dirname, '..', 'cache');
    this.geocodingCacheFile = path.join(this.cacheDir, 'geocoding.json');
    this.pdfCacheFile = path.join(this.cacheDir, 'pdf-extractions.json');
    
    // Ensure cache directory exists
    fs.ensureDirSync(this.cacheDir);
    
    // Load existing caches
    this.geocodingCache = this.loadCache(this.geocodingCacheFile);
    this.pdfCache = this.loadCache(this.pdfCacheFile);
    
    // Cache expiration (7 days for geocoding, 30 days for PDF)
    this.geocodingExpiry = 7 * 24 * 60 * 60 * 1000; // 7 days
    this.pdfExpiry = 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  loadCache(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (error) {
      console.error(`Failed to load cache from ${filePath}:`, error.message);
    }
    return {};
  }

  saveCache(cache, filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch (error) {
      console.error(`Failed to save cache to ${filePath}:`, error.message);
    }
  }

  // Geocoding cache methods
  getGeocodingCache(city, state) {
    const key = `${city.toLowerCase()}_${state.toLowerCase()}`;
    const cached = this.geocodingCache[key];
    
    if (cached && Date.now() - cached.timestamp < this.geocodingExpiry) {
      console.log(`Cache hit for geocoding: ${city}, ${state}`);
      return cached.coordinates;
    }
    
    return null;
  }

  setGeocodingCache(city, state, coordinates) {
    const key = `${city.toLowerCase()}_${state.toLowerCase()}`;
    this.geocodingCache[key] = {
      coordinates: coordinates,
      timestamp: Date.now(),
      city: city,
      state: state
    };
    
    this.saveCache(this.geocodingCache, this.geocodingCacheFile);
    console.log(`Cached geocoding for: ${city}, ${state}`);
  }

  // PDF processing cache methods
  getPDFCache(pdfPath) {
    const key = path.basename(pdfPath);
    const cached = this.pdfCache[key];
    
    if (cached && Date.now() - cached.timestamp < this.pdfExpiry) {
      // Also check if file still exists and hasn't been modified
      try {
        const stats = fs.statSync(pdfPath);
        if (stats.mtime.getTime() === cached.fileModified) {
          console.log(`Cache hit for PDF: ${key}`);
          return cached.extractedData;
        }
      } catch (error) {
        // File doesn't exist anymore, remove from cache
        delete this.pdfCache[key];
        this.saveCache(this.pdfCache, this.pdfCacheFile);
      }
    }
    
    return null;
  }

  setPDFCache(pdfPath, extractedData) {
    const key = path.basename(pdfPath);
    
    try {
      const stats = fs.statSync(pdfPath);
      this.pdfCache[key] = {
        extractedData: extractedData,
        timestamp: Date.now(),
        fileModified: stats.mtime.getTime(),
        filePath: pdfPath
      };
      
      this.saveCache(this.pdfCache, this.pdfCacheFile);
      console.log(`Cached PDF extraction for: ${key}`);
    } catch (error) {
      console.error(`Failed to cache PDF extraction for ${pdfPath}:`, error.message);
    }
  }

  // Course data cache methods (for USATF search results)
  getCourseCache(courseId) {
    const cached = this.pdfCache[`course_${courseId}`];
    
    if (cached && Date.now() - cached.timestamp < this.pdfExpiry) {
      console.log(`Cache hit for course: ${courseId}`);
      return cached.courseData;
    }
    
    return null;
  }

  setCourseCache(courseId, courseData) {
    this.pdfCache[`course_${courseId}`] = {
      courseData: courseData,
      timestamp: Date.now()
    };
    
    this.saveCache(this.pdfCache, this.pdfCacheFile);
    console.log(`Cached course data for: ${courseId}`);
  }

  // Cache maintenance
  cleanExpiredEntries() {
    let cleaned = 0;
    
    // Clean geocoding cache
    Object.keys(this.geocodingCache).forEach(key => {
      const entry = this.geocodingCache[key];
      if (Date.now() - entry.timestamp > this.geocodingExpiry) {
        delete this.geocodingCache[key];
        cleaned++;
      }
    });
    
    // Clean PDF cache
    Object.keys(this.pdfCache).forEach(key => {
      const entry = this.pdfCache[key];
      const expiry = key.startsWith('course_') ? this.pdfExpiry : this.pdfExpiry;
      if (Date.now() - entry.timestamp > expiry) {
        delete this.pdfCache[key];
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      this.saveCache(this.geocodingCache, this.geocodingCacheFile);
      this.saveCache(this.pdfCache, this.pdfCacheFile);
      console.log(`Cleaned ${cleaned} expired cache entries`);
    }
  }

  // Cache statistics
  getCacheStats() {
    return {
      geocoding: {
        entries: Object.keys(this.geocodingCache).length,
        size: JSON.stringify(this.geocodingCache).length
      },
      pdf: {
        entries: Object.keys(this.pdfCache).length,
        size: JSON.stringify(this.pdfCache).length
      }
    };
  }

  // Clear all caches
  clearAllCaches() {
    this.geocodingCache = {};
    this.pdfCache = {};
    this.saveCache(this.geocodingCache, this.geocodingCacheFile);
    this.saveCache(this.pdfCache, this.pdfCacheFile);
    console.log('All caches cleared');
  }
}

// Export singleton instance
const cacheService = new CacheService();

// Clean expired entries on startup and every 6 hours
cacheService.cleanExpiredEntries();
setInterval(() => {
  cacheService.cleanExpiredEntries();
}, 6 * 60 * 60 * 1000);

module.exports = cacheService;