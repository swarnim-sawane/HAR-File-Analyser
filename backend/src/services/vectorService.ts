import { getQdrant } from '../config/database';

/**
 * Delete all vectors for a file
 */
export async function deleteFileVectors(fileId: string, type: 'har' | 'log' = 'har'): Promise<void> {
  const qdrant = getQdrant();
  const collectionName = type === 'har' ? 'har_embeddings' : 'log_embeddings';
  
  try {
    await qdrant.delete(collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: 'fileId',
            match: { value: fileId }
          }
        ]
      }
    });
    
    console.log(`Deleted vectors for ${fileId} from ${collectionName}`);
  } catch (error) {
    console.error('Error deleting vectors:', error);
    throw error;
  }
}

/**
 * Get collection statistics
 */
export async function getCollectionStats(type: 'har' | 'log' = 'har'): Promise<any> {
  const qdrant = getQdrant();
  const collectionName = type === 'har' ? 'har_embeddings' : 'log_embeddings';
  
  try {
    const info = await qdrant.getCollection(collectionName);
    return info;
  } catch (error) {
    console.error('Error getting collection stats:', error);
    throw error;
  }
}

/**
 * Search similar entries
 */
export async function searchSimilar(
  fileId: string,
  vector: number[],
  type: 'har' | 'log' = 'har',
  limit: number = 5
): Promise<any[]> {
  const qdrant = getQdrant();
  const collectionName = type === 'har' ? 'har_embeddings' : 'log_embeddings';
  
  try {
    const results = await qdrant.search(collectionName, {
      vector,
      filter: {
        must: [
          {
            key: 'fileId',
            match: { value: fileId }
          }
        ]
      },
      limit,
      with_payload: true,
      with_vector: false
    });
    
    return results;
  } catch (error) {
    console.error('Error searching vectors:', error);
    throw error;
  }
}
