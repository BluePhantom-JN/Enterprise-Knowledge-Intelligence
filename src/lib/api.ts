import { auth } from './firebase.ts';
import type {
  AuditLogItem,
  ChatMessageItem,
  ChatSessionItem,
  ChunkStrategy,
  CitationChunk,
  CollectionItem,
  DocumentChunkItem,
  DocumentItem,
  RetrievalConfig,
  UserProfile,
  UserRole,
} from '../types/rag.ts';

async function getAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to perform this action.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders(
    init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }
  );
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchMe(): Promise<{
  user: UserProfile;
  stats: { collectionCount: number; documentCount: number; chunkCount: number };
}> {
  return apiFetch('/api/me');
}

export async function fetchCollections(): Promise<CollectionItem[]> {
  const data = await apiFetch<{ collections: CollectionItem[] }>('/api/collections');
  return data.collections;
}

export async function createCollectionApi(payload: {
  name: string;
  description: string;
  minRole: UserRole;
}): Promise<CollectionItem> {
  const data = await apiFetch<{ collection: CollectionItem }>('/api/collections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.collection;
}

export async function deleteCollectionApi(id: number): Promise<void> {
  await apiFetch(`/api/collections/${id}`, { method: 'DELETE' });
}

export async function fetchDocuments(params?: {
  collectionId?: number | null;
  fileType?: string;
  search?: string;
}): Promise<DocumentItem[]> {
  const query = new URLSearchParams();
  if (params?.collectionId) query.set('collectionId', String(params.collectionId));
  if (params?.fileType && params.fileType !== 'all') query.set('fileType', params.fileType);
  if (params?.search?.trim()) query.set('search', params.search.trim());
  const qs = query.toString();
  const data = await apiFetch<{ documents: DocumentItem[] }>(`/api/documents${qs ? `?${qs}` : ''}`);
  return data.documents;
}

export async function uploadDocumentApi(params: {
  file: File;
  collectionId: number;
  title: string;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
}): Promise<{ document: DocumentItem; latencyMs: number }> {
  const form = new FormData();
  form.append('file', params.file);
  form.append('collectionId', String(params.collectionId));
  form.append('title', params.title);
  form.append('chunkStrategy', params.chunkStrategy);
  form.append('chunkSize', String(params.chunkSize));
  form.append('chunkOverlap', String(params.chunkOverlap));

  return apiFetch('/api/documents/upload', {
    method: 'POST',
    body: form,
  });
}

export async function seedSampleCorpusApi(): Promise<{
  created: DocumentItem[];
  count: number;
  latencyMs: number;
}> {
  return apiFetch('/api/documents/seed-sample', { method: 'POST' });
}

export async function fetchDocumentChunks(documentId: number): Promise<{
  document: DocumentItem;
  rawContentLength: number;
  chunks: DocumentChunkItem[];
}> {
  return apiFetch(`/api/documents/${documentId}/chunks`);
}

export async function reindexDocumentApi(
  documentId: number,
  params: { chunkStrategy: ChunkStrategy; chunkSize: number; chunkOverlap: number }
): Promise<{
  document: DocumentItem;
  rawContentLength: number;
  chunks: DocumentChunkItem[];
  latencyMs: number;
}> {
  return apiFetch(`/api/documents/${documentId}/reindex`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function deleteDocumentApi(documentId: number): Promise<void> {
  await apiFetch(`/api/documents/${documentId}`, { method: 'DELETE' });
}

export async function fetchSessions(): Promise<ChatSessionItem[]> {
  const data = await apiFetch<{ sessions: ChatSessionItem[] }>('/api/sessions');
  return data.sessions;
}

export async function fetchSessionMessages(sessionId: number): Promise<ChatMessageItem[]> {
  const data = await apiFetch<{ messages: ChatMessageItem[] }>(`/api/sessions/${sessionId}/messages`);
  return data.messages;
}

export async function deleteSessionApi(sessionId: number): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function streamRagQuery(params: {
  query: string;
  sessionId: number | null;
  config: RetrievalConfig;
  onMeta: (meta: {
    sessionId: number;
    citations: CitationChunk[];
    retrievalLatencyMs: number;
  }) => void;
  onDelta: (text: string) => void;
  onDone: (payload: { sessionId: number; message: ChatMessageItem; latencyMs: number }) => void;
  onError: (message: string) => void;
}): Promise<void> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/rag/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: params.query,
      sessionId: params.sessionId,
      collectionIds: params.config.collectionIds,
      topK: params.config.topK,
      semanticWeight: params.config.semanticWeight,
      minScore: params.config.minScore,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    params.onError(errData.error || `Query failed (${response.status})`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    params.onError('Streaming response unavailable.');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = currentEvent;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;
    const rawJson = dataLines.join('\n');
    try {
      const parsed = JSON.parse(rawJson);
      if (eventName === 'meta') {
        params.onMeta(parsed);
      } else if (eventName === 'delta') {
        params.onDelta(parsed.text || '');
      } else if (eventName === 'done') {
        params.onDone(parsed);
      } else if (eventName === 'error') {
        params.onError(parsed.error || 'Retrieval or synthesis error.');
      }
    } catch {
      // Ignore malformed chunk fragments
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIdx = buffer.indexOf('\n\n');
    while (separatorIdx !== -1) {
      const block = buffer.slice(0, separatorIdx).trim();
      buffer = buffer.slice(separatorIdx + 2);
      if (block) processBlock(block);
      separatorIdx = buffer.indexOf('\n\n');
    }
  }
}

export async function fetchAdminUsers(): Promise<UserProfile[]> {
  const data = await apiFetch<{ users: UserProfile[] }>('/api/admin/users');
  return data.users;
}

export async function updateAdminUserRole(userId: number, role: UserRole): Promise<UserProfile> {
  const data = await apiFetch<{ user: UserProfile }>(`/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  return data.user;
}

export async function fetchAuditLogs(): Promise<AuditLogItem[]> {
  const data = await apiFetch<{ logs: AuditLogItem[] }>('/api/admin/audit-logs');
  return data.logs;
}
