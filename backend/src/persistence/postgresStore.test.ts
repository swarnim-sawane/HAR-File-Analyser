import { describe, expect, it } from 'vitest';
import { sanitizeForPostgresJson } from './postgresStore';

describe('sanitizeForPostgresJson', () => {
  it('preserves embedded NUL evidence as a PostgreSQL-safe visible marker', () => {
    const input = {
      request: {
        postData: {
          text: 'before\u0000after',
          nested: ['first', '\u0000second'],
        },
      },
      'key\u0000with-null': 'value',
    };

    expect(sanitizeForPostgresJson(input)).toEqual({
      request: {
        postData: {
          text: 'before\\u0000after',
          nested: ['first', '\\u0000second'],
        },
      },
      'key\\u0000with-null': 'value',
    });
    expect(input.request.postData.text).toBe('before\u0000after');
  });
});
