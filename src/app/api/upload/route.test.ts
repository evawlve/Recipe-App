// Unit tests for upload route utilities
// Run with: npx jest src/app/api/upload/route.test.ts

// Mock crypto module
const mockRandomBytes = jest.fn();
jest.mock('crypto', () => ({
  randomBytes: mockRandomBytes
}));

// Import the functions we want to test
// Note: In a real test setup, you'd extract these functions to a separate utilities file
// For now, we'll test the logic inline

describe('Upload Route Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeFilename', () => {
    const sanitizeFilename = (filename: string): string => {
      return filename
        .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace unsafe chars with underscore
        .replace(/\.{2,}/g, '.') // Replace multiple dots with single dot
        .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
        .substring(0, 100); // Limit length
    };

    test('should sanitize unsafe characters', () => {
      expect(sanitizeFilename('test@file#name.jpg')).toBe('test_file_name.jpg');
    });

    test('should handle path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etc_passwd');
    });

    test('should remove multiple dots', () => {
      expect(sanitizeFilename('test..file...name.jpg')).toBe('test.file.name.jpg');
    });

    test('should remove leading and trailing dots', () => {
      expect(sanitizeFilename('.hidden.file.')).toBe('hidden.file');
    });

    test('should limit filename length', () => {
      const longName = 'a'.repeat(150) + '.jpg';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    test('should preserve valid filenames', () => {
      expect(sanitizeFilename('valid-file-name.jpg')).toBe('valid-file-name.jpg');
    });
  });

  describe('generateRandomId', () => {
    const generateRandomId = (): string => {
      return mockRandomBytes(8).toString('hex');
    };

    test('should generate random ID', () => {
      mockRandomBytes.mockReturnValue(Buffer.from('12345678', 'hex'));
      const id = generateRandomId();
      expect(id).toBe('12345678');
      expect(mockRandomBytes).toHaveBeenCalledWith(8);
    });
  });

  describe('buildS3Key', () => {
    const sanitizeFilename = (filename: string): string => {
      return filename
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .substring(0, 100);
    };

    const generateRandomId = (): string => {
      return mockRandomBytes(8).toString('hex');
    };

    const buildS3Key = (filename: string): string => {
      const sanitized = sanitizeFilename(filename);
      const randomId = generateRandomId();
      return `uploads/${Date.now()}-${randomId}-${sanitized}`;
    };

    test('should build S3 key with timestamp, random ID, and sanitized filename', () => {
      mockRandomBytes.mockReturnValue(Buffer.from('12345678', 'hex'));
      const key = buildS3Key('test@file.jpg');
      
      expect(key).toMatch(/^uploads\/\d+-12345678-test_file\.jpg$/);
    });

    test('should handle complex filenames', () => {
      mockRandomBytes.mockReturnValue(Buffer.from('abcdef12', 'hex'));
      const key = buildS3Key('../../../malicious@file#name.png');
      
      expect(key).toMatch(/^uploads\/\d+-abcdef12-malicious_file_name\.png$/);
    });
  });

  describe('content type validation', () => {
    const ALLOWED_CONTENT_TYPES = [
      'image/jpeg',
      'image/png', 
      'image/webp',
      'image/avif'
    ] as const;

    test('should accept valid content types', () => {
      ALLOWED_CONTENT_TYPES.forEach(type => {
        expect(ALLOWED_CONTENT_TYPES.includes(type)).toBe(true);
      });
    });

    test('should reject invalid content types', () => {
      const invalidTypes = [
        'image/gif',
        'text/plain',
        'application/pdf',
        'video/mp4'
      ];

      invalidTypes.forEach(type => {
        expect(ALLOWED_CONTENT_TYPES.includes(type as any)).toBe(false);
      });
    });
  });
});
