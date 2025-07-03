#!/usr/bin/env python3
import re
import os
import sys
import json
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
    # Extract course ID
    course_id_match = re.match(r'(KS\d+\w+)', filename)
    course_id = course_id_match.group(1) if course_id_match else "Unknown"
    
    # Extract course name from filename
    if ' - ' in filename:
        course_name = filename.split(' - ')[1].replace('.pdf', '')
    else:
        course_name = filename.replace('.pdf', '')
    
    # Try strings extraction first
    strings_output = extract_strings_from_pdf(pdf_path)
    addresses = []
    venues = []
    
    if strings_output:
        # Look for address patterns
        address_patterns = [
            r'\d+\s+[A-Za-z][A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Place|Pl|Court|Ct|Circle|Cir|Parkway|Pkwy)',
            r'\d+\s+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}',
            r'[A-Za-z][A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Place|Pl|Court|Ct|Circle|Cir|Parkway|Pkwy)',
        ]
        
        for pattern in address_patterns:
            matches = re.findall(pattern, strings_output, re.IGNORECASE)
            addresses.extend(matches)
        
        # Look for venue/location names
        venue_keywords = ['Park', 'Center', 'School', 'Stadium', 'Field', 'Complex', 'Facility', 'Sports', 'Recreation', 'Community']
        
        lines = strings_output.split('\n')
        for line in lines:
            line = line.strip()
            if any(keyword.lower() in line.lower() for keyword in venue_keywords) and len(line) > 5:
                venues.append(line)
    else:
        # Try manual extraction
        manual_text = manual_text_extraction(pdf_path)
        if manual_text and len(manual_text) > 100:
            lines = manual_text.split(' ')
            for line in lines:
                if 'park' in line.lower() or 'center' in line.lower():
                    venues.append(line)
    
    return {
        'course_id': course_id,
        'course_name': course_name,
        'addresses': addresses,
        'venues': venues,
        'filename': filename
    }

def main():
    """Main function that can be called from command line or as module"""
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python advanced_pdf_extractor.py <pdf_path>"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    filename = os.path.basename(pdf_path)
    
    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)
    
    try:
        result = analyze_pdf_content(pdf_path, filename)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Failed to analyze PDF: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()