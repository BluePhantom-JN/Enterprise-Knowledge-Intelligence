export type UserRole = 'admin' | 'editor' | 'viewer';

export type ChunkStrategy = 'recursive' | 'fixed' | 'markdown' | 'csv_rows';

export type SupportedFileType = 'pdf' | 'md' | 'txt' | 'csv';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastActiveAt: string;
}

export interface CollectionItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  minRole: UserRole;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface DocumentItem {
  id: number;
  collectionId: number;
  collectionName: string;
  title: string;
  fileName: string;
  fileType: SupportedFileType;
  fileSizeBytes: number;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  chunkCount: number;
  status: 'ready' | 'indexing' | 'failed';
  uploaderEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunkItem {
  id: number;
  documentId: number;
  collectionId: number;
  chunkIndex: number;
  sectionHeading: string;
  content: string;
  charCount: number;
  tokenEstimate: number;
  createdAt: string;
}

export interface RetrievalConfig {
  collectionIds: number[]; // empty means all accessible collections
  topK: number; // 3 - 12
  semanticWeight: number; // 0.0 - 1.0 (1 - semanticWeight = lexical weight)
  minScore: number; // 0.0 - 0.8
}

export interface CitationChunk {
  citationNumber: number;
  chunkId: number;
  documentId: number;
  documentTitle: string;
  fileName: string;
  fileType: SupportedFileType;
  collectionId: number;
  collectionName: string;
  chunkIndex: number;
  sectionHeading: string;
  content: string;
  semanticScore: number; // 0 - 1 cosine similarity
  lexicalScore: number; // 0 - 1 normalized FTS rank
  rrfScore: number; // combined fused score
  semanticRank: number | null;
  lexicalRank: number | null;
}

export interface ChatSessionItem {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageItem {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant';
  content: string;
  retrievalConfig: RetrievalConfig | null;
  citations: CitationChunk[];
  latencyMs: number | null;
  createdAt: string;
}

export interface AuditLogItem {
  id: number;
  userEmail: string;
  action: string;
  resourceSummary: string;
  collectionScope: string;
  topScore: number | null;
  citationCount: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export function hasRoleAccess(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}
