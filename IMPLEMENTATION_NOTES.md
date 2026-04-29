# PPTX/Word File Upload Implementation

## Summary

This PR adds support for uploading PPTX and Word documents to Open Design, automatically extracting text and images for use in design generation workflows.

## Changes

### 1. New Document Parser Module (`daemon/document-parser.js`)
- **Word (.docx, .doc) parsing** using `mammoth` library
  - Extracts plain text content
  - Extracts embedded images
  - Provides metadata (word count, paragraph count)
  
- **PowerPoint (.pptx) parsing** using `jszip`
  - Extracts text from all slides
  - Extracts images from media folder
  - Provides slide-by-slide breakdown
  - Metadata includes slide count and word count

- **Validation**
  - File type checking
  - Size limit enforcement (10MB max)
  - Error handling with fallback to raw file upload

### 2. Backend Integration (`daemon/server.js`)
**Important: Manual edits required**

Add this import near the top:
```javascript
import {
  isDocumentFile,
  parseDocument,
  validateDocument,
} from './document-parser.js';
```

Update the `/api/projects/:id/upload` endpoint (around line 663) to:
1. Detect document files using `isDocumentFile()`
2. Call `parseDocument()` to extract content
3. Save extracted text as `<filename>-extracted-text.txt`
4. Save extracted images with sanitized names
5. Return both original file and extracted files in response

See the implementation in the patch file or the updated server.js in this branch.

### 3. Frontend Updates

#### `src/components/ChatComposer.tsx`
- Added `accept="image/*,.pdf,.docx,.doc,.pptx,.ppt"` to file input
- Added `looksLikeDocument()` helper function
- Enhanced `uploadFiles()` to detect and log document processing
- Improved user feedback for document uploads

#### `daemon/projects.js`
- Added MIME types for document files:
  - `.docx`: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `.doc`: `application/msword`
  - `.pptx`: `application/vnd.openxmlformats-officedocument.presentationml.presentation`
  - `.ppt`: `application/vnd.ms-powerpoint`
  - `.pdf`: `application/pdf`
- Updated `kindFor()` to recognize `'document'` file kind

### 4. Dependencies

Added to `package.json`:
```json
{
  "mammoth": "^1.12.0",  // Word document parsing
  "jszip": "^3.10.1",     // PPTX ZIP extraction
  "pizzip": "^3.2.0"      // Additional ZIP utilities
}
```

## Features

### Drag & Drop Support
Users can drag PPTX/Word files directly into the chat composer. The files are automatically:
1. Validated (type and size)
2. Uploaded to the project folder
3. Parsed to extract text and images
4. Made available as `@-mentionable` files in the chat

### Extracted Content
For each uploaded document:
- **Original file** is preserved in the project folder
- **Extracted text** is saved as `<filename>-extracted-text.txt`
- **Embedded images** are saved individually with generated names
- All files appear in the project file list and can be @-mentioned

### Error Handling
- If parsing fails, the original file is still uploaded
- Validation errors are logged but don't block upload
- Parse errors include descriptive messages

## Usage Example

1. User drags `presentation.pptx` into chat
2. System uploads and parses it
3. Chat composer shows:
   - `presentation.pptx` (original)
   - `presentation-extracted-text.txt` (text content)
   - `extracted-image-xxx.png` (any embedded images)
4. User can @-mention any of these files
5. AI agent can read the extracted text to understand content

## Testing

### Manual Testing Steps

1. **Start the dev server:**
   ```bash
   npm run dev:all
   ```

2. **Test Word upload:**
   - Create or download a `.docx` file with text and images
   - Drag it into the chat composer
   - Verify extracted text file appears
   - Verify images are extracted

3. **Test PowerPoint upload:**
   - Create or download a `.pptx` file
   - Drag it into the chat composer
   - Verify slide text is extracted
   - Verify media images are extracted

4. **Test validation:**
   - Try uploading a file >10MB (should warn)
   - Try uploading unsupported format (should reject)

### Sample Test Files

Create test files:
```bash
# Word doc with sample content
echo "Test document content" > test.txt
# Convert to docx using any word processor

# Or download samples from:
# - Microsoft Office templates
# - Google Docs (export as DOCX/PPTX)
```

## Architecture Notes

### Why mammoth for Word?
- Mature, well-maintained library
- Handles both .doc and .docx
- Good image extraction support
- Converts to HTML for easier text extraction

### Why JSZip for PowerPoint?
- PPTX files are ZIP archives containing XML
- Direct XML parsing gives fine-grained control
- No heavy dependencies
- Can extract both text and media

### Alternative Approaches Considered

1. **officegen** - More for generation than parsing
2. **pptxgenjs** - Similar, focused on creation
3. **node-pptx** - Less mature
4. **docx library** - Word-only, less features than mammoth

## Future Enhancements

- [ ] Add progress indicators for large file uploads
- [ ] Support PDF text extraction (pdf-parse library)
- [ ] Preserve formatting metadata (fonts, colors, layouts)
- [ ] Add preview thumbnails for uploaded documents
- [ ] Support Excel files (.xlsx) for data extraction
- [ ] Batch processing for multiple documents
- [ ] OCR for scanned documents within PPTX/Word

## Related Issues

Closes nexu-io/open-design#42

## Screenshots

_Add screenshots of:_
- File input accepting documents
- Drag & drop UI with document files
- Project file list showing extracted content
- Chat with @-mentioned document content
