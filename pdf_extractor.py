#!/usr/bin/env python3
import re
import os

def extract_text_from_pdf(pdf_path):
    """
    Attempt to extract readable text from PDF by looking for text patterns
    in the binary content. This is a basic approach but may work for some PDFs.
    """
    try:
        with open(pdf_path, 'rb') as f:
            content = f.read()
            
        # Convert to text using latin-1 encoding to preserve all bytes
        text_content = content.decode('latin-1', errors='ignore')
        
        # Look for readable text patterns
        # Extract sequences of printable characters
        readable_text = []
        current_word = ""
        
        for char in text_content:
            if char.isprintable() and char not in '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f':
                current_word += char
            else:
                if len(current_word) > 3:  # Only keep words longer than 3 characters
                    readable_text.append(current_word)
                current_word = ""
        
        if current_word and len(current_word) > 3:
            readable_text.append(current_word)
            
        return " ".join(readable_text)
        
    except Exception as e:
        return f"Error reading file: {e}"

def find_course_info(text, filename):
    """Extract course information from the text"""
    info = {
        'course_id': '',
        'course_name': '',
        'address': '',
        'venue': '',
        'other_details': []
    }
    
    # Extract course ID from filename
    course_id_match = re.match(r'(KS\d+\w+)', filename)
    if course_id_match:
        info['course_id'] = course_id_match.group(1)
    
    # Look for common patterns in race certification documents
    text_upper = text.upper()
    
    # Common address patterns
    address_patterns = [
        r'\d+\s+[A-Z][A-Z\s]+(?:STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|BOULEVARD|BLVD|LANE|LN|WAY|PLACE|PL|COURT|CT|CIRCLE|CIR|PARKWAY|PKWY)',
        r'\d+\s+[A-Z\s]+,\s*[A-Z]{2}\s+\d{5}',
        r'[A-Z][A-Z\s]+(?:STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR)',
    ]
    
    addresses = []
    for pattern in address_patterns:
        matches = re.findall(pattern, text_upper)
        addresses.extend(matches)
    
    if addresses:
        info['address'] = addresses[0]
    
    # Look for venue names (common keywords in race documents)
    venue_keywords = ['PARK', 'CENTER', 'SCHOOL', 'STADIUM', 'FIELD', 'COMPLEX', 'FACILITY']
    venues = []
    
    words = text_upper.split()
    for i, word in enumerate(words):
        if any(keyword in word for keyword in venue_keywords):
            # Get some context around the venue keyword
            start = max(0, i-3)
            end = min(len(words), i+3)
            venue_context = ' '.join(words[start:end])
            venues.append(venue_context)
    
    if venues:
        info['venue'] = venues[0]
    
    return info

# List of target PDF files
target_files = [
    "KS23012TJD - Patriots Run 5k.pdf",
    "KS23020TJD - Gobbler Grind '23 Alternate 5K.pdf",
    "KS25001DT - Kansas City Mother's Day 5 km.pdf",
    "KS22022TJD - Jared Coones Memorial Pumpkin Run.pdf",
    "KS18019TJD - Heartland Soccer 5k.pdf",
    "KS15045KH - Bug Run 5k.pdf",
    "KS22033TJD - Gobbler Grind 2022 5k.pdf",
    "KS20015TJD - Gobbler Grind 5K 2020.pdf",
    "KS19007TJD - BVRC Special Olympics 5K.pdf",
    "KS17013TJD - Komen KC 5K.pdf"
]

assets_dir = "/mnt/c/Github/raceMap/public/assets"

print("Extracting information from PDF certification documents:\n")
print("=" * 80)

for filename in target_files:
    filepath = os.path.join(assets_dir, filename)
    if os.path.exists(filepath):
        print(f"\nProcessing: {filename}")
        print("-" * 50)
        
        text = extract_text_from_pdf(filepath)
        info = find_course_info(text, filename)
        
        print(f"Course ID: {info['course_id']}")
        print(f"Filename: {filename}")
        
        # Try to extract course name from filename if not found in text
        if not info['course_name']:
            name_part = filename.split(' - ')[1] if ' - ' in filename else filename
            info['course_name'] = name_part.replace('.pdf', '')
        
        print(f"Course Name: {info['course_name']}")
        print(f"Address: {info['address']}")
        print(f"Venue: {info['venue']}")
        
        # Show some of the extracted text for manual review
        if len(text) > 200:
            print(f"Sample text (first 200 chars): {text[:200]}...")
        else:
            print(f"Extracted text: {text}")
            
    else:
        print(f"\nFile not found: {filename}")

print("\n" + "=" * 80)
print("Extraction complete. Note: This is a basic text extraction method.")
print("For better results, consider using specialized PDF processing tools.")