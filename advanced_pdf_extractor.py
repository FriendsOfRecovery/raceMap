#!/usr/bin/env python3
import re
import os
import subprocess

def extract_strings_from_pdf(pdf_path):
    """Extract all readable strings from PDF using strings command"""
    try:
        result = subprocess.run(['strings', pdf_path], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout
        else:
            return ""
    except:
        return ""

def manual_text_extraction(pdf_path):
    """Manual text extraction by reading binary and looking for patterns"""
    try:
        with open(pdf_path, 'rb') as f:
            content = f.read()
        
        # Convert to string
        text = content.decode('latin-1', errors='ignore')
        
        # Look for text between parentheses (common in PDF text encoding)
        paren_matches = re.findall(r'\(([^)]+)\)', text)
        
        # Look for text after BT and before ET commands (PDF text objects)
        bt_et_pattern = r'BT\s*(.*?)\s*ET'
        bt_et_matches = re.findall(bt_et_pattern, text, re.DOTALL)
        
        # Look for readable strings (sequences of printable characters)
        readable_strings = []
        current_string = ""
        
        for char in text:
            if char.isprintable() and char not in '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f':
                current_string += char
            else:
                if len(current_string) > 2:
                    readable_strings.append(current_string.strip())
                current_string = ""
        
        # Combine all extracted text
        all_text = []
        all_text.extend(paren_matches)
        all_text.extend([match.strip() for match in bt_et_matches])
        all_text.extend(readable_strings)
        
        return ' '.join(all_text)
        
    except Exception as e:
        return f"Error: {e}"

def analyze_pdf_content(pdf_path, filename):
    """Analyze PDF content for course information"""
    print(f"\n{'='*60}")
    print(f"ANALYZING: {filename}")
    print(f"{'='*60}")
    
    # Extract course ID
    course_id_match = re.match(r'(KS\d+\w+)', filename)
    course_id = course_id_match.group(1) if course_id_match else "Unknown"
    
    # Extract course name from filename
    if ' - ' in filename:
        course_name = filename.split(' - ')[1].replace('.pdf', '')
    else:
        course_name = filename.replace('.pdf', '')
    
    print(f"Course ID: {course_id}")
    print(f"Course Name: {course_name}")
    
    # Try strings extraction first
    strings_output = extract_strings_from_pdf(pdf_path)
    
    if strings_output:
        print(f"\nStrings extraction successful ({len(strings_output)} characters)")
        
        # Look for address patterns
        address_patterns = [
            r'\d+\s+[A-Za-z][A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Place|Pl|Court|Ct|Circle|Cir|Parkway|Pkwy)',
            r'\d+\s+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}',
            r'[A-Za-z][A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Place|Pl|Court|Ct|Circle|Cir|Parkway|Pkwy)',
        ]
        
        addresses = []
        for pattern in address_patterns:
            matches = re.findall(pattern, strings_output, re.IGNORECASE)
            addresses.extend(matches)
        
        # Look for venue/location names
        venue_keywords = ['Park', 'Center', 'School', 'Stadium', 'Field', 'Complex', 'Facility', 'Sports', 'Recreation', 'Community']
        venues = []
        
        lines = strings_output.split('\n')
        for line in lines:
            line = line.strip()
            if any(keyword.lower() in line.lower() for keyword in venue_keywords) and len(line) > 5:
                venues.append(line)
        
        # Display findings
        if addresses:
            print(f"Addresses found: {addresses[:3]}")  # Show first 3
        else:
            print("No clear addresses found")
            
        if venues:
            print(f"Venues found: {venues[:3]}")  # Show first 3
        else:
            print("No clear venues found")
            
        # Show sample of extracted text
        sample_lines = [line.strip() for line in strings_output.split('\n') if len(line.strip()) > 5][:10]
        if sample_lines:
            print(f"\nSample extracted text:")
            for i, line in enumerate(sample_lines[:5]):
                print(f"  {i+1}. {line}")
    else:
        print("Strings extraction failed, trying manual extraction...")
        
        # Try manual extraction
        manual_text = manual_text_extraction(pdf_path)
        if manual_text and len(manual_text) > 100:
            print(f"Manual extraction successful ({len(manual_text)} characters)")
            print(f"Sample text: {manual_text[:200]}...")
        else:
            print("Manual extraction also failed or returned minimal text")
    
    return {
        'course_id': course_id,
        'course_name': course_name,
        'addresses': addresses if 'addresses' in locals() else [],
        'venues': venues if 'venues' in locals() else []
    }

# Target files
target_files = [
    "KS23012TJD - Patriots Run 5k.pdf",
    "KS23020TJD - Gobbler Grind '23 Alternate 5K.pdf",
    "KS25001DT - Kansas City Mother's Day 5 km.pdf",
    "KS22022TJD - Jared Coones Memorial Pumpkin Run.pdf",
    "KS18019TJD - Heartland Soccer 5k.pdf",
    "KS15045KH - Bug Run  5k.pdf",  # Note: extra spaces in filename
    "KS22033TJD - Gobbler Grind 2022 5k.pdf",
    "KS20015TJD - Gobbler Grind 5K 2020.pdf",
    "KS19007TJD - BVRC Special Olympics 5K.pdf",
    "KS17013TJD - Komen KC 5K.pdf"
]

assets_dir = "/mnt/c/Github/raceMap/public/assets"
all_results = []

print("Advanced PDF Analysis - Race Course Certification Documents")
print("="*80)

for filename in target_files:
    filepath = os.path.join(assets_dir, filename)
    if os.path.exists(filepath):
        result = analyze_pdf_content(filepath, filename)
        all_results.append(result)
    else:
        print(f"\nFile not found: {filename}")

# Summary
print(f"\n{'='*80}")
print("SUMMARY OF EXTRACTED INFORMATION")
print(f"{'='*80}")

for result in all_results:
    print(f"\nCourse ID: {result['course_id']}")
    print(f"Course Name: {result['course_name']}")
    if result['addresses']:
        print(f"Address: {result['addresses'][0]}")
    else:
        print("Address: Not clearly identified")
    if result['venues']:
        print(f"Venue: {result['venues'][0]}")
    else:
        print("Venue: Not clearly identified")
    print("-" * 40)