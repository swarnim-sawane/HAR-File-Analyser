import { describe, it, expect } from 'vitest';
import { HarParser } from '../harParser';
import { makeHarFile, makeHarJson, makeEntry } from '../../test-utils/fixtures';

function makeFile(content: string, name = 'test.har'): File {
  const blob = new Blob([content], { type: 'application/json' });
  return new File([blob], name, { type: 'application/json' });
}

describe('HarParser.parseFile — valid files', () => {
  it('parses a valid minimal HAR file', async () => {
    const parser = new HarParser();
    const result = await parser.parseFile(makeFile(makeHarJson()));
    expect(result.log.version).toBe('1.2');
    expect(result.log.creator.name).toBe('TestBrowser');
    expect(result.log.entries).toHaveLength(1);
  });

  it('parses a HAR with multiple entries', async () => {
    const parser = new HarParser();
    const entries = Array.from({ length: 5 }, () => makeEntry());
    const result = await parser.parseFile(makeFile(makeHarJson(entries)));
    expect(result.log.entries).toHaveLength(5);
  });

  it('parses a HAR with pages', async () => {
    const parser = new HarParser();
    const harData = makeHarFile();
    harData.log.pages = [{
      startedDateTime: '2024-01-15T10:00:00Z',
      id: 'page_1',
      title: 'Home',
      pageTimings: {},
    }];
    const result = await parser.parseFile(makeFile(JSON.stringify(harData)));
    expect(result.log.pages).toHaveLength(1);
    expect(result.log.pages![0].title).toBe('Home');
  });

  it('exposes getEntries() after parsing', async () => {
    const parser = new HarParser();
    const entries = [makeEntry(), makeEntry()];
    await parser.parseFile(makeFile(makeHarJson(entries)));
    expect(parser.getEntries()).toHaveLength(2);
  });

  it('exposes getPages() after parsing', async () => {
    const parser = new HarParser();
    const harData = makeHarFile();
    harData.log.pages = [{
      startedDateTime: '2024-01-15T10:00:00Z',
      id: 'page_1',
      title: 'Test',
      pageTimings: {},
    }];
    await parser.parseFile(makeFile(JSON.stringify(harData)));
    expect(parser.getPages()).toHaveLength(1);
  });

  it('exposes getCreator() after parsing', async () => {
    const parser = new HarParser();
    await parser.parseFile(makeFile(makeHarJson()));
    expect(parser.getCreator()?.name).toBe('TestBrowser');
  });

  it('parses a HAR with empty entries array', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: { version: '1.2', creator: { name: 'Test', version: '1' }, entries: [] },
    });
    const result = await parser.parseFile(makeFile(har));
    expect(result.log.entries).toHaveLength(0);
    expect(parser.getEntries()).toHaveLength(0);
  });
});

describe('HarParser.parseFile — error cases', () => {
  it('rejects with error for malformed JSON', async () => {
    const parser = new HarParser();
    await expect(parser.parseFile(makeFile('{ this is not valid json }'))).rejects.toThrow();
  });

  it('rejects with "Invalid HAR file format" when log.entries is missing', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: { version: '1.2', creator: { name: 'X', version: '1' } },
    });
    await expect(parser.parseFile(makeFile(har))).rejects.toThrow('Invalid HAR file format');
  });

  it('rejects when the root log key is missing', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({ version: '1.2', entries: [] });
    await expect(parser.parseFile(makeFile(har))).rejects.toThrow('Invalid HAR file format');
  });

  it('rejects for completely empty file', async () => {
    const parser = new HarParser();
    await expect(parser.parseFile(makeFile(''))).rejects.toThrow();
  });

  it('rejects when entries is not an array', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: { version: '1.2', creator: { name: 'X', version: '1' }, entries: 'not-array' },
    });
    await expect(parser.parseFile(makeFile(har))).rejects.toThrow('Invalid HAR file format');
  });

  it('rejects when log.version is missing', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: { creator: { name: 'X', version: '1' }, entries: [] },
    });
    await expect(parser.parseFile(makeFile(har))).rejects.toThrow('Invalid HAR file format');
  });

  it('rejects when log.creator is missing', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: { version: '1.2', entries: [] },
    });
    await expect(parser.parseFile(makeFile(har))).rejects.toThrow('Invalid HAR file format');
  });
});
