const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class CourseService {
  constructor() {
    this.downloadsDir = path.join(__dirname, '..', 'downloads');
    fs.ensureDirSync(this.downloadsDir);
  }

  async searchUSATFDatabase(searchParams) {
    try {
      console.log('Searching USATF database with params:', searchParams);
      
      // Build form data exactly matching USATF form structure
      const formData = new URLSearchParams();
      
      // Always include these default parameters
      formData.append('searchBtn', 'Search');
      formData.append('Status', searchParams.status || ''); // Any status by default
      formData.append('Type', searchParams.type || ''); // Any type by default
      
      // Basic search parameters
      if (searchParams.courseId) {
        formData.append('mcc_course_num', searchParams.courseId);
      }
      
      if (searchParams.distance) {
        formData.append('Dist', searchParams.distance);
        formData.append('Units', 'm');
        formData.append('courseDistanceComparison', searchParams.distanceComparison || '=');
      } else {
        // Empty distance fields
        formData.append('Dist', '');
        formData.append('Units', '');
        formData.append('courseDistanceComparison', '');
      }
      
      if (searchParams.city) {
        formData.append('City', searchParams.city);
      } else {
        formData.append('City', '');
      }
      
      if (searchParams.state) {
        formData.append('State', searchParams.state);
      } else {
        formData.append('State', '');
      }
      
      if (searchParams.courseName) {
        formData.append('Name', searchParams.courseName);
      } else {
        formData.append('Name', '');
      }
      
      if (searchParams.measurer) {
        formData.append('Measurer', searchParams.measurer);
      } else {
        formData.append('Measurer', '');
      }
      
      // World Athletics course number (not used but in form)
      formData.append('mwc_cert_num', '');
      
      // Drop parameters
      if (searchParams.maxDrop) {
        formData.append('mcc_drop', searchParams.maxDrop);
        formData.append('courseDropComparison', '<=');
      } else {
        formData.append('mcc_drop', '');
        formData.append('courseDropComparison', '');
      }
      
      // Separation parameters
      if (searchParams.maxSeparation) {
        formData.append('Sep', searchParams.maxSeparation);
        formData.append('courseSeparationComparison', '<=');
      } else {
        formData.append('Sep', '');
        formData.append('courseSeparationComparison', '>'); // Default from form
      }
      
      // Certification year
      if (searchParams.certYear) {
        formData.append('courseCertYear', searchParams.certYear);
      } else {
        formData.append('courseCertYear', '');
      }
      
      // Certifier's last name (not used but in form)
      formData.append('master_certifier_ln', '');
      
      // Create search-serialized field (mimic jQuery behavior)
      const serializedData = formData.toString();
      formData.append('search-serialized', serializedData);

      // Debug: Log what we're sending
      console.log('Form data being sent:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}: "${value}"`);
      }

      const response = await axios.post('https://certifiedroadraces.com/search/', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 30000
      });

      return this.parseSearchResults(response.data);
      
    } catch (error) {
      console.error('USATF search error:', error.message);
      throw new Error(`Failed to search USATF database: ${error.message}`);
    }
  }

  parseSearchResults(html) {
    const $ = cheerio.load(html);
    const courses = [];

    // Check if no results
    if (html.includes('No courses match your search criteria')) {
      console.log('No courses found in USATF database');
      return courses;
    }

    // Debug: Log key parts of the HTML response
    console.log('Response length:', html.length);
    console.log('Contains "No courses match":', html.includes('No courses match your search criteria'));
    console.log('Contains results div:', html.includes('<div id = "results"'));
    
    // Look for any table structures
    const tableMatches = html.match(/<table[^>]*>/gi);
    console.log('Number of tables found:', tableMatches ? tableMatches.length : 0);
    
    // Look for any course ID patterns in the response
    const courseIdMatches = html.match(/[A-Z]{2}\d{5}[A-Z]{1,3}/g);
    console.log('Course IDs in response:', courseIdMatches ? courseIdMatches.slice(0, 5) : 'None found');

    // Look for results in various possible structures
    // Try to find table rows with course data
    const tableRows = $('table tr').filter((index, element) => {
      const text = $(element).text();
      return /[A-Z]{2}\d{5}[A-Z]{1,3}/.test(text); // Contains course ID pattern
    });

    if (tableRows.length > 0) {
      console.log(`Found ${tableRows.length} table rows with course data`);
      tableRows.each((index, row) => {
        const course = this.parseTableRow($, $(row));
        if (course && course.id) {
          courses.push(course);
        }
      });
    }

    // If no table results, try to extract course IDs from plain text
    if (courses.length === 0) {
      console.log('No table results found, trying text extraction...');
      const courseMatches = html.match(/([A-Z]{2}\d{5}[A-Z]{1,3})/g);
      if (courseMatches) {
        console.log(`Found ${courseMatches.length} course IDs in text:`, courseMatches);
        courseMatches.forEach(match => {
          courses.push({
            id: match,
            name: `Course ${match}`,
            city: '',
            state: '',
            distance: 5000,
            status: 'A'
          });
        });
      }
    }

    console.log(`Parsed ${courses.length} courses from USATF results`);
    return courses;
  }

  parseTableRow($, $row) {
    const cells = $row.find('td');
    if (cells.length < 10) return null; // Need at least 10 columns

    // Based on the HTML structure, the columns are:
    // 0: #, 1: Course ID, 2: Name, 3: Distance, 4: City, 5: State, 
    // 6: Measurer, 7: Certifier Last Name, 8: Type, 9: Drop, 10: Separation, 
    // 11: Record Eligible, 12: Status, 13: Expiration, 14: Replaces, 15: WA Certified

    const courseId = $(cells[1]).find('a').text().trim() || $(cells[1]).text().trim();
    if (!courseId || !courseId.match(/[A-Z]{2}\d{5}[A-Z]{1,3}/)) return null;

    const name = $(cells[2]).text().trim();
    const distance = this.parseDistance($(cells[3]).text().trim());
    const city = $(cells[4]).text().trim();
    const state = $(cells[5]).text().trim();
    const measurer = $(cells[6]).text().trim();
    const certifierLastName = $(cells[7]).text().trim();
    const type = $(cells[8]).text().trim();
    const drop = parseFloat($(cells[9]).text().trim()) || 0;
    const separation = parseFloat($(cells[10]).text().trim()) || 0;
    const status = $(cells[12]).text().trim();
    const expiration = $(cells[13]).text().trim();

    // Extract certification year from expiration
    const certYear = expiration ? expiration : '';

    return {
      id: courseId,
      name: name || `Course ${courseId}`,
      city: city,
      state: state,
      distance: distance,
      measurer: measurer,
      certifierLastName: certifierLastName,
      type: type,
      certYear: certYear,
      status: status,
      drop: drop,
      separation: separation,
      expiration: expiration,
      // Extract certificate URL from the link
      certificateUrl: $(cells[1]).find('a').attr('href') || null
    };
  }

  parseDistance(distanceText) {
    if (distanceText.includes('5 km') || distanceText.includes('5K')) return 5000;
    if (distanceText.includes('10 km') || distanceText.includes('10K')) return 10000;
    if (distanceText.includes('half') || distanceText.includes('Half')) return 21097;
    if (distanceText.includes('marathon') || distanceText.includes('Marathon')) return 42195;
    
    // Try to extract numeric value
    const numMatch = distanceText.match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const num = parseFloat(numMatch[1]);
      if (distanceText.includes('km')) return num * 1000;
      if (distanceText.includes('mi')) return num * 1609.34;
      return num; // assume meters
    }
    
    return 5000; // default
  }

  extractDistance(cellTexts) {
    for (const text of cellTexts) {
      if (text.includes('5000') || text.includes('5K')) return 5000;
      if (text.includes('10000') || text.includes('10K')) return 10000;
      if (text.includes('21097') || text.includes('Half')) return 21097;
      if (text.includes('42195') || text.includes('Marathon')) return 42195;
    }
    return null;
  }

  extractYear(cellTexts) {
    for (const text of cellTexts) {
      const yearMatch = text.match(/20\d{2}/);
      if (yearMatch) return yearMatch[0];
    }
    return '';
  }

  extractFloat(cellTexts, type) {
    for (const text of cellTexts) {
      if (type === 'drop' && text.toLowerCase().includes('drop')) {
        const match = text.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
      }
      if (type === 'sep' && text.toLowerCase().includes('sep')) {
        const match = text.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
      }
    }
    return 0;
  }

  // Test function to check if we can get any results at all
  async testUSATFConnection() {
    try {
      console.log('Testing USATF connection...');
      const testParams = {
        state: 'KS',
        status: 'A'
      };
      
      const formData = new URLSearchParams({
        State: 'KS',
        Status: 'A',
        searchBtn: 'Search'
      });

      const response = await axios.post('https://certifiedroadraces.com/search/', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 30000
      });

      console.log('USATF response status:', response.status);
      console.log('Response length:', response.data.length);
      
      // Look for course patterns in response
      const courseMatches = response.data.match(/([A-Z]{2}\d{5}[A-Z]{1,3})/g);
      console.log('Course IDs found:', courseMatches ? courseMatches.slice(0, 5) : 'None');
      
      return response.data;
    } catch (error) {
      console.error('USATF test connection failed:', error.message);
      return null;
    }
  }

  async findCoursePDF(course) {
    console.log(`Searching for PDF for course: ${course.id}`);
    
    // Try multiple strategies to find the PDF
    const strategies = [
      () => this.searchLocalPDFs(course),
      () => this.searchUSATFCertificateURL(course), // NEW: Use the direct certificate URL
      () => this.searchUSATFDirectLinks(course),
      () => this.searchRaceWebsites(course),
      () => this.searchRunningCalendars(course)
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.pdfPath) {
          console.log(`Found PDF for ${course.id}: ${result.pdfPath}`);
          return result;
        }
      } catch (error) {
        console.log(`Strategy failed for ${course.id}: ${error.message}`);
      }
    }

    console.log(`No PDF found for course: ${course.id}`);
    return null;
  }

  async searchUSATFCertificateURL(course) {
    // Use the direct certificate URL from the search results
    if (!course.certificateUrl) return null;
    
    try {
      console.log(`Trying USATF certificate URL: ${course.certificateUrl}`);
      
      // The URL points to a certificate page, we need to fetch it and look for PDF links
      const response = await axios.get(course.certificateUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for PDF download links
      const pdfLinks = $('a[href*=".pdf"], a[href*="download"], a[href*="cert"]').toArray();
      
      for (const link of pdfLinks) {
        const href = $(link).attr('href');
        if (href && (href.includes('.pdf') || href.includes('download'))) {
          let fullUrl = href;
          if (!href.startsWith('http')) {
            fullUrl = `https://certifiedroadraces.com${href.startsWith('/') ? '' : '/'}${href}`;
          }
          
          console.log(`Found PDF link: ${fullUrl}`);
          return await this.downloadPDF(fullUrl, course);
        }
      }
      
      // If no PDF links found, the page itself might be downloadable
      if (response.headers['content-type'] && response.headers['content-type'].includes('pdf')) {
        return await this.downloadPDF(course.certificateUrl, course);
      }
      
      console.log(`No PDF found on certificate page for ${course.id}`);
      return null;
      
    } catch (error) {
      console.log(`Certificate URL search failed for ${course.id}: ${error.message}`);
      return null;
    }
  }

  async searchLocalPDFs(course) {
    // Check if we already have this PDF locally
    const possibleFilenames = [
      `${course.id}.pdf`,
      `${course.id} - ${course.name}.pdf`,
      `${course.name}.pdf`
    ];

    const existingAssets = await fs.readdir(path.join(__dirname, '..', 'public', 'assets'));
    
    for (const filename of possibleFilenames) {
      const match = existingAssets.find(asset => 
        asset.toLowerCase().includes(course.id.toLowerCase()) ||
        (course.name && asset.toLowerCase().includes(course.name.toLowerCase().substring(0, 10)))
      );
      
      if (match) {
        const localPath = path.join(__dirname, '..', 'public', 'assets', match);
        if (await fs.pathExists(localPath)) {
          return {
            pdfPath: localPath,
            source: 'local',
            filename: match
          };
        }
      }
    }

    return null;
  }

  async searchUSATFDirectLinks(course) {
    // Try to find direct USATF PDF links
    try {
      const searchUrl = `https://certifiedroadraces.com/certificate/${course.id}`;
      const response = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const pdfLinks = $('a[href*=".pdf"], a[href*="certificate"], a[href*="cert"]').toArray();
      
      for (const link of pdfLinks) {
        const href = $(link).attr('href');
        if (href && href.includes('.pdf')) {
          const fullUrl = href.startsWith('http') ? href : `https://certifiedroadraces.com${href}`;
          return await this.downloadPDF(fullUrl, course);
        }
      }
    } catch (error) {
      console.log(`USATF direct search failed for ${course.id}: ${error.message}`);
    }

    return null;
  }

  async searchRaceWebsites(course) {
    // Search common race websites and directories
    const searchQueries = [
      `"${course.id}" race course certification filetype:pdf`,
      `"${course.name}" USATF certified course filetype:pdf`,
      `"${course.id}" course map filetype:pdf site:*.com`
    ];

    // This would require implementing web scraping for various race sites
    // For now, return null - can be expanded with specific race organization APIs
    return null;
  }

  async searchRunningCalendars(course) {
    // Search running calendar sites like RunSignup, Active.com, etc.
    // This would require implementing specific API integrations
    return null;
  }

  async downloadPDF(url, course) {
    try {
      console.log(`Downloading PDF from: ${url}`);
      
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const filename = `${course.id} - ${course.name || 'Course'}.pdf`;
      const filePath = path.join(this.downloadsDir, filename);
      
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`PDF downloaded: ${filename}`);
          resolve({
            pdfPath: filePath,
            source: 'download',
            filename: filename,
            url: url
          });
        });
        
        writer.on('error', reject);
      });
      
    } catch (error) {
      console.error(`Failed to download PDF from ${url}:`, error.message);
      throw error;
    }
  }

  async extractPDFData(pdfPath) {
    try {
      console.log(`Extracting data from PDF: ${pdfPath}`);
      
      // Use the existing Python PDF extractor
      const pythonScript = path.join(__dirname, '..', 'advanced_pdf_extractor.py');
      
      if (!await fs.pathExists(pythonScript)) {
        console.log('Python PDF extractor not found, skipping extraction');
        return null;
      }

      return new Promise((resolve, reject) => {
        const python = spawn('python', [pythonScript, pdfPath]);
        let output = '';
        let error = '';

        python.stdout.on('data', (data) => {
          output += data.toString();
        });

        python.stderr.on('data', (data) => {
          error += data.toString();
        });

        python.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(output);
              console.log(`Successfully extracted PDF data for: ${path.basename(pdfPath)}`);
              resolve(result);
            } catch (parseError) {
              console.error('Failed to parse PDF extraction result:', parseError.message);
              resolve(null);
            }
          } else {
            console.error(`PDF extraction failed with code ${code}: ${error}`);
            resolve(null);
          }
        });
      });
      
    } catch (error) {
      console.error('PDF extraction error:', error.message);
      return null;
    }
  }
}

// Export singleton instance
const courseService = new CourseService();

module.exports = {
  searchUSATFDatabase: (searchParams) => courseService.searchUSATFDatabase(searchParams),
  findCoursePDF: (course) => courseService.findCoursePDF(course),
  extractPDFData: (pdfPath) => courseService.extractPDFData(pdfPath)
};