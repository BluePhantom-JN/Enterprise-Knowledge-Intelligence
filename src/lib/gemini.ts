import { GoogleGenAI } from '@google/genai';

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const GENERATION_MODEL = 'gemini-4-hydrogen';
export const EMBEDDING_DIMENSIONS = 768;

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGeminiClient();
  const vectors: number[][] = [];
  const batchSize = 16;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });

    const embeddings = result.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: expected ${batch.length}, received ${embeddings.length}`);
    }

    for (const emb of embeddings) {
      if (!emb.values || emb.values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Unexpected embedding dimensionality: ${emb.values?.length ?? 0}`);
      }
      vectors.push(emb.values);
    }
  }

  return vectors;
}

export async function embedQuery(query: string): Promise<number[]> {
  const vectors = await embedTexts([query]);
  return vectors[0];
}
