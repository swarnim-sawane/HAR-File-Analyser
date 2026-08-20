import { describe, expect, it } from 'vitest';
import {
  HarEntryStreamParser,
  MAX_PREVIEW_ENTRY_CHARS,
  redactPreviewUrl,
} from './progressiveHarPreview';

const entry = (index: number, url = `https://example.com/api/items/${index}?token=secret#detail`) => ({
  startedDateTime: `2026-08-18T10:00:${String(index).padStart(2, '0')}.000Z`,
  time: 12.6 + index,
  request: { method: 'GET', url },
  response: { status: 200, statusText: 'OK', bodySize: 128 + index, content: { size: 256 } },
});

const pushInChunks = (parser: HarEntryStreamParser, source: string, chunkSize: number) => {
  const emitted = [];
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    emitted.push(...parser.push(source.slice(offset, offset + chunkSize)));
  }
  return emitted;
};

describe('HarEntryStreamParser', () => {
  it('emits request metadata before a standard HAR document finishes', () => {
    const parser = new HarEntryStreamParser();
    const source = JSON.stringify({ log: { version: '1.2', entries: [entry(0), entry(1)] } });
    const firstEntryEnd = source.indexOf('},{') + 1;

    const early = parser.push(source.slice(0, firstEntryEnd));
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ index: 0, method: 'GET', status: 200 });
    expect(early[0].url).toBe('https://example.com/api/items/0');

    parser.push(source.slice(firstEntryEnd));
    expect(parser.finish()).toMatchObject({ totalParsed: 2, isTruncated: false });
  });

  it('supports top-level entry arrays used by OC captures', () => {
    const parser = new HarEntryStreamParser();
    const emitted = pushInChunks(parser, JSON.stringify([entry(0), entry(1)]), 17);

    expect(emitted).toHaveLength(2);
    expect(parser.finish().totalParsed).toBe(2);
  });

  it('handles a BOM, escaped JSON syntax, and one-character chunk boundaries', () => {
    const parser = new HarEntryStreamParser();
    const escaped = entry(0, 'https://example.com/a%7Bb%7D?q=secret');
    pushInChunks(parser, `\uFEFF  ${JSON.stringify({ log: { entries: [escaped] } })}`, 1);

    expect(parser.finish()).toMatchObject({ totalParsed: 1 });
  });

  it('retains only the configured first requests while counting all valid entries', () => {
    const parser = new HarEntryStreamParser(2);
    pushInChunks(parser, JSON.stringify({ log: { entries: [entry(0), entry(1), entry(2)] } }), 23);

    const result = parser.finish();
    expect(result.totalParsed).toBe(3);
    expect(result.retained).toHaveLength(2);
    expect(result.isTruncated).toBe(true);
  });

  it('redacts query strings and fragments and bounds retained URLs', () => {
    expect(redactPreviewUrl('https://example.com/path?access_token=secret#fragment'))
      .toBe('https://example.com/path');
    expect(redactPreviewUrl(`not-a-url/${'x'.repeat(5_000)}?secret=yes`).length).toBeLessThanOrEqual(4_096);
  });

  it('rejects incomplete and empty entries arrays', () => {
    const incomplete = new HarEntryStreamParser();
    incomplete.push('{"log":{"entries":[{"request":');
    expect(() => incomplete.finish()).toThrow(/request entry was complete/);

    const empty = new HarEntryStreamParser();
    empty.push('{"log":{"entries":[]}}');
    expect(() => empty.finish()).toThrow(/valid request entries/);
  });

  it('rejects missing arrays, invalid entry fields, and trailing garbage', () => {
    const missing = new HarEntryStreamParser();
    missing.push('{"log":{"version":"1.2"}}');
    expect(() => missing.finish()).toThrow(/entries array/);

    const invalidFields = new HarEntryStreamParser();
    expect(() => pushInChunks(
      invalidFields,
      JSON.stringify({ log: { entries: [entry(0), { request: { method: 'GET' } }] } }),
      11,
    )).toThrow(/invalid request entry/);

    const trailing = new HarEntryStreamParser();
    trailing.push(`${JSON.stringify({ log: { entries: [entry(0)] } })} unexpected`);
    expect(() => trailing.finish()).toThrow(/HAR document was complete/);
  });

  it('skips an oversized entry without retaining it and resumes with later requests', () => {
    const parser = new HarEntryStreamParser();
    const oversized = {
      ...entry(1),
      response: {
        ...entry(1).response,
        content: { size: MAX_PREVIEW_ENTRY_CHARS + 1, text: 'x'.repeat(MAX_PREVIEW_ENTRY_CHARS + 1) },
      },
    };
    const source = JSON.stringify({ log: { entries: [entry(0), oversized, entry(2)] } });

    expect(() => pushInChunks(parser, source, 64 * 1024)).not.toThrow();
    const result = parser.finish();

    expect(result).toMatchObject({
      totalParsed: 2,
      skippedOversizedEntries: 1,
      isTruncated: true,
    });
    expect(result.retained.map((request) => request.index)).toEqual([0, 2]);
    expect(result.retained[1].url).toBe('https://example.com/api/items/2');
  });

  it('treats an all-oversized entries array as a degraded preview, not an invalid HAR', () => {
    const parser = new HarEntryStreamParser();
    const oversized = {
      ...entry(0),
      response: {
        ...entry(0).response,
        content: { size: MAX_PREVIEW_ENTRY_CHARS + 1, text: 'x'.repeat(MAX_PREVIEW_ENTRY_CHARS + 1) },
      },
    };

    pushInChunks(parser, JSON.stringify({ log: { entries: [oversized] } }), 64 * 1024);

    expect(parser.finish()).toMatchObject({
      totalParsed: 0,
      skippedOversizedEntries: 1,
      retained: [],
      isTruncated: true,
    });
  });
});
