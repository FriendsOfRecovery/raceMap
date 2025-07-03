# Race Course Finder

A dynamic web application that searches for USATF-certified running courses anywhere in the United States and automatically attempts to find their certification PDFs.

## Features

- **Dynamic Course Search**: Search by city, state, and distance
- **USATF Database Integration**: Real-time search of the official USATF course database
- **Automatic PDF Discovery**: Attempts to find and download course certification PDFs
- **PDF Content Extraction**: Extracts addresses and venue information from PDFs
- **Interactive Map**: Visual display of found courses with location markers
- **Responsive Design**: Works on desktop and mobile devices

## How It Works

1. **User Search**: Users enter a city, state, and distance (5K, 10K, etc.)
2. **USATF Query**: Backend scrapes the USATF database for matching courses
3. **PDF Discovery**: System searches for certification PDFs using multiple strategies:
   - Local PDF cache
   - USATF direct links
   - Race organization websites
   - Running calendar sites
4. **Content Extraction**: Python scripts extract key information from found PDFs
5. **Results Display**: Courses are displayed with maps, details, and PDF links

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd raceMap
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Ensure Python is available** (for PDF extraction):
   ```bash
   python --version  # Should be Python 3.x
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

5. **Open your browser** to `http://localhost:3000`

## Usage

### Basic Search
1. Enter a city name (e.g., "Boston")
2. Select a state from the dropdown
3. Choose a distance (default: 5K)
4. Click "Search Courses"

### Example Searches
- Boston, MA - Find courses in the Boston area
- Austin, TX - Discover Texas running courses
- Chicago, IL - Search Illinois certified courses
- Overland Park, KS - Find Kansas courses (includes the original local data)

### Features
- **Course Details**: View course ID, name, location, and expiration dates
- **PDF Certification**: Download and view official USATF certification documents
- **Interactive Map**: See course locations plotted on a map
- **Cache System**: Repeated searches use cached results for faster responses

## API Endpoints

### POST /api/search-courses
Search for courses by location and distance.

**Request Body**:
```json
{
  "city": "Boston",
  "state": "MA",
  "distance": 5000
}
```

**Response**:
```json
{
  "courses": [
    {
      "id": "MA12345ABC",
      "name": "Boston Marathon 5K",
      "city": "Boston",
      "state": "MA",
      "distance": 5000,
      "pdfUrl": "/api/pdf/MA12345ABC-course.pdf",
      "extractedData": {
        "addresses": ["123 Main St, Boston, MA"],
        "venues": ["Boston Common"]
      }
    }
  ],
  "message": "Found 1 courses",
  "searchParams": {
    "city": "Boston",
    "state": "MA",
    "distance": 5000
  }
}
```

### GET /api/pdf/:filename
Serve PDF certification documents.

### GET /api/states
Get list of available states for search dropdown.

## Architecture

### Backend (Node.js/Express)
- **server.js**: Main Express server
- **services/courseService.js**: USATF search and PDF discovery logic
- **downloads/**: Directory for downloaded PDF files

### Frontend (HTML/CSS/JavaScript)
- **index.html**: Main application interface with search and results
- **viewer.html**: PDF viewer for certification documents
- **public/**: Static assets and existing PDF files

### PDF Processing (Python)
- **advanced_pdf_extractor.py**: Extracts text and data from PDF files
- Outputs JSON for integration with Node.js backend

## Configuration

### Environment Variables
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

### Cache Settings
- Default cache TTL: 1 hour (3600 seconds)
- Configurable in server.js

## Development

### Adding New PDF Discovery Sources
Extend the `courseService.js` with new search strategies:

```javascript
async function searchNewSource(course) {
  // Implement new PDF discovery logic
  return {
    pdfPath: 'path/to/found.pdf',
    source: 'new-source',
    url: 'https://example.com/pdf'
  };
}
```

### Improving PDF Extraction
Enhance `advanced_pdf_extractor.py` with new extraction patterns:

```python
def extract_new_data(pdf_text):
    # Add new extraction logic
    pattern = r'new-pattern-here'
    matches = re.findall(pattern, pdf_text)
    return matches
```

## Troubleshooting

### Common Issues

1. **No courses found**: 
   - Check spelling of city name
   - Try nearby cities
   - Verify state selection

2. **PDF extraction fails**:
   - Ensure Python is in PATH
   - Check file permissions
   - Verify PDF file integrity

3. **Server won't start**:
   - Check if port 3000 is available
   - Verify all dependencies are installed
   - Check Node.js version compatibility

### Debug Mode
Enable detailed logging by setting `NODE_ENV=development`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- USATF for maintaining the course certification database
- OpenStreetMap for map tiles
- Leaflet.js for mapping functionality