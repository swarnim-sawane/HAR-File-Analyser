import { createReadStream } from 'fs';
import { promises as fs } from 'fs';

/**
 * Split file into chunks for processing
 */
export async function chunkFile(
  filePath: string,
  chunkSize: number = 5 * 1024 * 1024 // 5MB default
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  const fileHandle = await fs.open(filePath, 'r');
  
  try {
    const stats = await fileHandle.stat();
    const totalSize = stats.size;
    let offset = 0;
    
    while (offset < totalSize) {
      const buffer = Buffer.alloc(Math.min(chunkSize, totalSize - offset));
      await fileHandle.read(buffer, 0, buffer.length, offset);
      chunks.push(buffer);
      offset += buffer.length;
    }
  } finally {
    await fileHandle.close();
  }
  
  return chunks;
}

/**
 * Calculate optimal chunk size based on file size
 */
export function calculateChunkSize(fileSize: number): number {
  if (fileSize < 10 * 1024 * 1024) {
    // Files < 10MB: 1MB chunks
    return 1 * 1024 * 1024;
  } else if (fileSize < 100 * 1024 * 1024) {
    // Files 10-100MB: 5MB chunks
    return 5 * 1024 * 1024;
  } else {
    // Files > 100MB: 10MB chunks
    return 10 * 1024 * 1024;
  }
}
