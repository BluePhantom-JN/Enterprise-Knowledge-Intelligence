import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  chatMessages,
  chatSessions,
  collections,
  documentChunks,
  documents,
  users,
} from './schema.ts';
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
  SupportedFileType,
  UserProfile,
  UserRole,
} from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';
import type { GeneratedChunk } from '../lib/chunking.ts';

const INITIAL_ADMIN_EMAIL = 'dhayalanaravindan@gmail.com';

function toUserProfile(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    displayName: row.displayName,
    role: (row.role as UserRole) || 'viewer',
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
  };
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName: string
): Promise<UserProfile> {
  try {
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (existing.length > 0) {
      const updated = await db
        .update(users)
        .set({
          email,
          displayName: displayName || existing[0].displayName,
          lastActiveAt: new Date(),
        })
        .where(eq(users.uid, uid))
        .returning();
      return toUserProfile(updated[0]);
    }

    const adminCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'admin'));
    const hasExistingAdmin = (adminCountResult[0]?.count ?? 0) > 0;
    const assignedRole: UserRole =
      email.toLowerCase() === INITIAL_ADMIN_EMAIL || !hasExistingAdmin ? 'admin' : 'viewer';

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName || email.split('@')[0] || 'Workspace Member',
        role: assignedRole,
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          lastActiveAt: new Date(),
        },
      })
      .returning();

    return toUserProfile(inserted[0]);
  } catch (error) {
    console.error('Failed to upsert user:', error);
    throw new Error('Unable to synchronize user profile.', { cause: error });
  }
}

export async function ensureDefaultCollections(creatorUserId: number): Promise<void> {
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(collections);
    if ((existing[0]?.count ?? 0) > 0) return;

    await db
      .insert(collections)
      .values([
        {
          name: 'Security & Compliance',
          slug: 'security-compliance',
          description: 'SOC 2 policies, incident response procedures, and access governance.',
          minRole: 'viewer',
          createdBy: creatorUserId,
        },
        {
          name: 'Engineering Architecture',
          slug: 'engineering-architecture',
          description: 'System design docs, infrastructure runbooks, and API standards.',
          minRole: 'viewer',
          createdBy: creatorUserId,
        },
        {
          name: 'Operations & Finance',
          slug: 'operations-finance',
          description: 'Cloud expenditure ledgers, vendor SLAs, and quarterly operating tables.',
          minRole: 'editor',
          createdBy: creatorUserId,
        },
      ])
      .onConflictDoNothing();
  } catch (error) {
    console.error('Failed to ensure default collections:', error);
    throw new Error('Unable to initialize workspace collections.', { cause: error });
  }
}

export async function listAccessibleCollections(userRole: UserRole): Promise<CollectionItem[]> {
  try {
    const allCollections = await db
      .select()
      .from(collections)
      .orderBy(collections.name);

    const visible = allCollections.filter((c) =>
      hasRoleAccess(userRole, (c.minRole as UserRole) || 'viewer')
    );

    if (visible.length === 0) return [];

    const visibleIds = visible.map((c) => c.id);
    const docStats = await db
      .select({
        collectionId: documents.collectionId,
        docCount: sql<number>`count(*)::int`,
        chunkSum: sql<number>`coalesce(sum(${documents.chunkCount}), 0)::int`,
      })
      .from(documents)
      .where(inArray(documents.collectionId, visibleIds))
      .groupBy(documents.collectionId);

    const statsMap = new Map(docStats.map((s) => [s.collectionId, s]));

    return visible.map((c) => {
      const stat = statsMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        minRole: (c.minRole as UserRole) || 'viewer',
        documentCount: stat?.docCount ?? 0,
        chunkCount: stat?.chunkSum ?? 0,
        createdAt: c.createdAt.toISOString(),
      };
    });
  } catch (error) {
    console.error('Failed to list collections:', error);
    throw new Error('Unable to load collections.', { cause: error });
  }
}

export async function createCollection(params: {
  name: string;
  description: string;
  minRole: UserRole;
  createdBy: number;
}): Promise<CollectionItem> {
  try {
    const baseSlug = params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48);
    const slug = `${baseSlug || 'collection'}-${Date.now().toString(36).slice(-4)}`;

    const inserted = await db
      .insert(collections)
      .values({
        name: params.name.trim(),
        slug,
        description: params.description.trim(),
        minRole: params.minRole,
        createdBy: params.createdBy,
      })
      .returning();

    const row = inserted[0];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      minRole: row.minRole as UserRole,
      documentCount: 0,
      chunkCount: 0,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to create collection:', error);
    throw new Error('Unable to create collection.', { cause: error });
  }
}

export async function deleteCollectionById(collectionId: number): Promise<boolean> {
  try {
    const deleted = await db
      .delete(collections)
      .where(eq(collections.id, collectionId))
      .returning({ id: collections.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete collection:', error);
    throw new Error('Unable to delete collection.', { cause: error });
  }
}

export async function listAccessibleDocuments(
  userRole: UserRole,
  filters?: { collectionId?: number; fileType?: string; search?: string }
): Promise<DocumentItem[]> {
  try {
    const accessibleCols = await listAccessibleCollections(userRole);
    if (accessibleCols.length === 0) return [];

    const colNameMap = new Map(accessibleCols.map((c) => [c.id, c.name]));
    const allowedColIds = accessibleCols.map((c) => c.id);

    if (filters?.collectionId && !allowedColIds.includes(filters.collectionId)) {
      return [];
    }

    const targetColIds = filters?.collectionId ? [filters.collectionId] : allowedColIds;

    const rows = await db
      .select({
        doc: documents,
        uploaderEmail: users.email,
      })
      .from(documents)
      .leftJoin(users, eq(documents.uploadedBy, users.id))
      .where(inArray(documents.collectionId, targetColIds))
      .orderBy(desc(documents.updatedAt));

    let items: DocumentItem[] = rows.map(({ doc, uploaderEmail }) => ({
      id: doc.id,
      collectionId: doc.collectionId,
      collectionName: colNameMap.get(doc.collectionId) ?? 'Collection',
      title: doc.title,
      fileName: doc.fileName,
      fileType: doc.fileType as SupportedFileType,
      fileSizeBytes: doc.fileSizeBytes,
      chunkStrategy: doc.chunkStrategy as ChunkStrategy,
      chunkSize: doc.chunkSize,
      chunkOverlap: doc.chunkOverlap,
      chunkCount: doc.chunkCount,
      status: doc.status as 'ready' | 'indexing' | 'failed',
      uploaderEmail: uploaderEmail ?? null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));

    if (filters?.fileType && filters.fileType !== 'all') {
      items = items.filter((d) => d.fileType === filters.fileType);
    }

    if (filters?.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      items = items.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q) ||
          d.collectionName.toLowerCase().includes(q)
      );
    }

    return items;
  } catch (error) {
    console.error('Failed to list documents:', error);
    throw new Error('Unable to load documents.', { cause: error });
  }
}

export async function createDocumentWithChunks(params: {
  collectionId: number;
  title: string;
  fileName: string;
  fileType: SupportedFileType;
  fileSizeBytes: number;
  rawContent: string;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  uploadedBy: number;
  chunks: GeneratedChunk[];
  embeddings: number[][];
}): Promise<DocumentItem> {
  try {
    const colRows = await db
      .select()
      .from(collections)
      .where(eq(collections.id, params.collectionId))
      .limit(1);
    if (colRows.length === 0) {
      throw new Error('Selected collection does not exist.');
    }

    const result = await db.transaction(async (tx) => {
      const [insertedDoc] = await tx
        .insert(documents)
        .values({
          collectionId: params.collectionId,
          title: params.title.trim(),
          fileName: params.fileName,
          fileType: params.fileType,
          fileSizeBytes: params.fileSizeBytes,
          rawContent: params.rawContent,
          chunkStrategy: params.chunkStrategy,
          chunkSize: params.chunkSize,
          chunkOverlap: params.chunkOverlap,
          chunkCount: params.chunks.length,
          status: 'ready',
          uploadedBy: params.uploadedBy,
        })
        .returning();

      if (params.chunks.length > 0) {
        await tx.insert(documentChunks).values(
          params.chunks.map((chunk, i) => ({
            documentId: insertedDoc.id,
            collectionId: params.collectionId,
            chunkIndex: chunk.chunkIndex,
            sectionHeading: chunk.sectionHeading,
            content: chunk.content,
            charCount: chunk.charCount,
            tokenEstimate: chunk.tokenEstimate,
            embedding: params.embeddings[i],
          }))
        );
      }

      return insertedDoc;
    });

    const uploaderRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, params.uploadedBy))
      .limit(1);

    return {
      id: result.id,
      collectionId: result.collectionId,
      collectionName: colRows[0].name,
      title: result.title,
      fileName: result.fileName,
      fileType: result.fileType as SupportedFileType,
      fileSizeBytes: result.fileSizeBytes,
      chunkStrategy: result.chunkStrategy as ChunkStrategy,
      chunkSize: result.chunkSize,
      chunkOverlap: result.chunkOverlap,
      chunkCount: result.chunkCount,
      status: result.status as 'ready' | 'indexing' | 'failed',
      uploaderEmail: uploaderRows[0]?.email ?? null,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to store document and chunks:', error);
    throw new Error('Unable to save indexed document.', { cause: error });
  }
}

export async function getDocumentWithChunks(
  documentId: number,
  userRole: UserRole
): Promise<{ document: DocumentItem; rawContentLength: number; chunks: DocumentChunkItem[] } | null> {
  try {
    const docRows = await db
      .select({
        doc: documents,
        collection: collections,
        uploaderEmail: users.email,
      })
      .from(documents)
      .innerJoin(collections, eq(documents.collectionId, collections.id))
      .leftJoin(users, eq(documents.uploadedBy, users.id))
      .where(eq(documents.id, documentId))
      .limit(1);

    if (docRows.length === 0) return null;
    const { doc, collection, uploaderEmail } = docRows[0];

    if (!hasRoleAccess(userRole, (collection.minRole as UserRole) || 'viewer')) {
      return null;
    }

    const chunkRows = await db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        collectionId: documentChunks.collectionId,
        chunkIndex: documentChunks.chunkIndex,
        sectionHeading: documentChunks.sectionHeading,
        content: documentChunks.content,
        charCount: documentChunks.charCount,
        tokenEstimate: documentChunks.tokenEstimate,
        createdAt: documentChunks.createdAt,
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(documentChunks.chunkIndex);

    return {
      document: {
        id: doc.id,
        collectionId: doc.collectionId,
        collectionName: collection.name,
        title: doc.title,
        fileName: doc.fileName,
        fileType: doc.fileType as SupportedFileType,
        fileSizeBytes: doc.fileSizeBytes,
        chunkStrategy: doc.chunkStrategy as ChunkStrategy,
        chunkSize: doc.chunkSize,
        chunkOverlap: doc.chunkOverlap,
        chunkCount: doc.chunkCount,
        status: doc.status as 'ready' | 'indexing' | 'failed',
        uploaderEmail: uploaderEmail ?? null,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      },
      rawContentLength: doc.rawContent.length,
      chunks: chunkRows.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error('Failed to fetch document chunks:', error);
    throw new Error('Unable to load document chunks.', { cause: error });
  }
}

export async function getDocumentRawForReindex(documentId: number) {
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to read document for reindex:', error);
    throw new Error('Unable to load document for re-indexing.', { cause: error });
  }
}

export async function replaceDocumentChunks(params: {
  documentId: number;
  collectionId: number;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  chunks: GeneratedChunk[];
  embeddings: number[][];
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, params.documentId));

      if (params.chunks.length > 0) {
        await tx.insert(documentChunks).values(
          params.chunks.map((chunk, i) => ({
            documentId: params.documentId,
            collectionId: params.collectionId,
            chunkIndex: chunk.chunkIndex,
            sectionHeading: chunk.sectionHeading,
            content: chunk.content,
            charCount: chunk.charCount,
            tokenEstimate: chunk.tokenEstimate,
            embedding: params.embeddings[i],
          }))
        );
      }

      await tx
        .update(documents)
        .set({
          chunkStrategy: params.chunkStrategy,
          chunkSize: params.chunkSize,
          chunkOverlap: params.chunkOverlap,
          chunkCount: params.chunks.length,
          status: 'ready',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, params.documentId));
    });
  } catch (error) {
    console.error('Failed to replace document chunks:', error);
    throw new Error('Unable to re-index document chunks.', { cause: error });
  }
}

export async function deleteDocumentById(documentId: number): Promise<string | null> {
  try {
    const deleted = await db
      .delete(documents)
      .where(eq(documents.id, documentId))
      .returning({ title: documents.title });
    return deleted[0]?.title ?? null;
  } catch (error) {
    console.error('Failed to delete document:', error);
    throw new Error('Unable to delete document.', { cause: error });
  }
}

export async function hybridSearchChunks(params: {
  queryText: string;
  queryEmbedding: number[];
  allowedCollectionIds: number[];
  topK: number;
  semanticWeight: number;
  minScore: number;
}): Promise<CitationChunk[]> {
  if (params.allowedCollectionIds.length === 0) return [];

  try {
    const vectorLiteral = `[${params.queryEmbedding.join(',')}]`;
    const candidateLimit = Math.max(20, params.topK * 4);
    const semWeight = Math.max(0, Math.min(1, params.semanticWeight));
    const lexWeight = 1 - semWeight;

    const semanticRows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documentChunks.documentId,
        documentTitle: documents.title,
        fileName: documents.fileName,
        fileType: documents.fileType,
        collectionId: documentChunks.collectionId,
        collectionName: collections.name,
        chunkIndex: documentChunks.chunkIndex,
        sectionHeading: documentChunks.sectionHeading,
        content: documentChunks.content,
        semanticScore: sql<number>`(1 - (${documentChunks.embedding} <=> ${vectorLiteral}::vector))::float8`,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .innerJoin(collections, eq(documentChunks.collectionId, collections.id))
      .where(inArray(documentChunks.collectionId, params.allowedCollectionIds))
      .orderBy(sql`${documentChunks.embedding} <=> ${vectorLiteral}::vector ASC`)
      .limit(candidateLimit);

    const lexicalRows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documentChunks.documentId,
        documentTitle: documents.title,
        fileName: documents.fileName,
        fileType: documents.fileType,
        collectionId: documentChunks.collectionId,
        collectionName: collections.name,
        chunkIndex: documentChunks.chunkIndex,
        sectionHeading: documentChunks.sectionHeading,
        content: documentChunks.content,
        lexicalRaw: sql<number>`ts_rank_cd(to_tsvector('english', ${documentChunks.sectionHeading} || ' ' || ${documentChunks.content}), websearch_to_tsquery('english', ${params.queryText}))::float8`,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .innerJoin(collections, eq(documentChunks.collectionId, collections.id))
      .where(
        and(
          inArray(documentChunks.collectionId, params.allowedCollectionIds),
          sql`to_tsvector('english', ${documentChunks.sectionHeading} || ' ' || ${documentChunks.content}) @@ websearch_to_tsquery('english', ${params.queryText})`
        )
      )
      .orderBy(
        sql`ts_rank_cd(to_tsvector('english', ${documentChunks.sectionHeading} || ' ' || ${documentChunks.content}), websearch_to_tsquery('english', ${params.queryText})) DESC`
      )
      .limit(candidateLimit);

    const maxLex = lexicalRows.reduce((m, r) => Math.max(m, r.lexicalRaw || 0), 0);

    type Candidate = Omit<CitationChunk, 'citationNumber'>;
    const merged = new Map<number, Candidate>();
    const RRF_K = 60;

    semanticRows.forEach((row, idx) => {
      const rank = idx + 1;
      const clampedSem = Math.max(0, Math.min(1, Number(row.semanticScore) || 0));
      merged.set(row.chunkId, {
        chunkId: row.chunkId,
        documentId: row.documentId,
        documentTitle: row.documentTitle,
        fileName: row.fileName,
        fileType: row.fileType as SupportedFileType,
        collectionId: row.collectionId,
        collectionName: row.collectionName,
        chunkIndex: row.chunkIndex,
        sectionHeading: row.sectionHeading,
        content: row.content,
        semanticScore: clampedSem,
        lexicalScore: 0,
        rrfScore: semWeight * (1 / (RRF_K + rank)),
        semanticRank: rank,
        lexicalRank: null,
      });
    });

    lexicalRows.forEach((row, idx) => {
      const rank = idx + 1;
      const normalizedLex = maxLex > 0 ? Math.min(1, (Number(row.lexicalRaw) || 0) / maxLex) : 0;
      const lexContribution = lexWeight * (1 / (RRF_K + rank));
      const existing = merged.get(row.chunkId);
      if (existing) {
        existing.lexicalScore = normalizedLex;
        existing.lexicalRank = rank;
        existing.rrfScore += lexContribution;
      } else {
        merged.set(row.chunkId, {
          chunkId: row.chunkId,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          fileName: row.fileName,
          fileType: row.fileType as SupportedFileType,
          collectionId: row.collectionId,
          collectionName: row.collectionName,
          chunkIndex: row.chunkIndex,
          sectionHeading: row.sectionHeading,
          content: row.content,
          semanticScore: 0,
          lexicalScore: normalizedLex,
          rrfScore: lexContribution,
          semanticRank: null,
          lexicalRank: rank,
        });
      }
    });

    const maxPossibleRrf = 1 / (RRF_K + 1);
    const ranked = Array.from(merged.values())
      .map((item) => ({
        ...item,
        // Normalize fused RRF score into readable 0..1 range
        rrfScore: Math.min(1, item.rrfScore / maxPossibleRrf),
      }))
      .filter((item) => Math.max(item.semanticScore, item.lexicalScore) >= params.minScore)
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, params.topK);

    return ranked.map((item, idx) => ({
      ...item,
      citationNumber: idx + 1,
    }));
  } catch (error) {
    console.error('Hybrid vector + lexical search failed:', error);
    throw new Error('Unable to search knowledge base.', { cause: error });
  }
}

export async function listUserSessions(userId: number): Promise<ChatSessionItem[]> {
  try {
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(40);

    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((s) => s.id);
    const counts = await db
      .select({
        sessionId: chatMessages.sessionId,
        count: sql<number>`count(*)::int`,
      })
      .from(chatMessages)
      .where(inArray(chatMessages.sessionId, sessionIds))
      .groupBy(chatMessages.sessionId);

    const countMap = new Map(counts.map((c) => [c.sessionId, c.count]));
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messageCount: countMap.get(s.id) ?? 0,
    }));
  } catch (error) {
    console.error('Failed to list chat sessions:', error);
    throw new Error('Unable to load conversation history.', { cause: error });
  }
}

export async function createChatSession(userId: number, title: string): Promise<number> {
  try {
    const [inserted] = await db
      .insert(chatSessions)
      .values({
        userId,
        title: title.trim().slice(0, 90) || 'New Knowledge Query',
      })
      .returning({ id: chatSessions.id });
    return inserted.id;
  } catch (error) {
    console.error('Failed to create chat session:', error);
    throw new Error('Unable to start conversation session.', { cause: error });
  }
}

export async function verifySessionOwner(sessionId: number, userId: number): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    console.error('Failed to verify session owner:', error);
    throw new Error('Unable to verify session access.', { cause: error });
  }
}

export async function listSessionMessages(
  sessionId: number,
  userId: number
): Promise<ChatMessageItem[] | null> {
  try {
    const owns = await verifySessionOwner(sessionId, userId);
    if (!owns) return null;

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt, chatMessages.id);

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      retrievalConfig: r.retrievalConfigJson ? (JSON.parse(r.retrievalConfigJson) as RetrievalConfig) : null,
      citations: r.citationsJson ? (JSON.parse(r.citationsJson) as CitationChunk[]) : [],
      latencyMs: r.latencyMs ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Failed to load session messages:', error);
    throw new Error('Unable to load session messages.', { cause: error });
  }
}

export async function appendChatMessage(params: {
  sessionId: number;
  role: 'user' | 'assistant';
  content: string;
  retrievalConfig?: RetrievalConfig | null;
  citations?: CitationChunk[];
  latencyMs?: number | null;
}): Promise<ChatMessageItem> {
  try {
    const [inserted] = await db
      .insert(chatMessages)
      .values({
        sessionId: params.sessionId,
        role: params.role,
        content: params.content,
        retrievalConfigJson: params.retrievalConfig ? JSON.stringify(params.retrievalConfig) : null,
        citationsJson: params.citations ? JSON.stringify(params.citations) : null,
        latencyMs: params.latencyMs ?? null,
      })
      .returning();

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, params.sessionId));

    return {
      id: inserted.id,
      sessionId: inserted.sessionId,
      role: inserted.role as 'user' | 'assistant',
      content: inserted.content,
      retrievalConfig: params.retrievalConfig ?? null,
      citations: params.citations ?? [],
      latencyMs: inserted.latencyMs ?? null,
      createdAt: inserted.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to save chat message:', error);
    throw new Error('Unable to persist message.', { cause: error });
  }
}

export async function deleteSessionById(sessionId: number, userId: number): Promise<boolean> {
  try {
    const deleted = await db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .returning({ id: chatSessions.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete session:', error);
    throw new Error('Unable to delete conversation.', { cause: error });
  }
}

export async function writeAuditLog(params: {
  userId: number;
  userEmail: string;
  action: string;
  resourceSummary: string;
  collectionScope?: string;
  topScore?: number | null;
  citationCount?: number | null;
  latencyMs?: number | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      userEmail: params.userEmail,
      action: params.action,
      resourceSummary: params.resourceSummary.slice(0, 300),
      collectionScope: params.collectionScope ?? 'All Collections',
      topScore: params.topScore ?? null,
      citationCount: params.citationCount ?? null,
      latencyMs: params.latencyMs ?? null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function listAllUsers(): Promise<UserProfile[]> {
  try {
    const rows = await db.select().from(users).orderBy(desc(users.lastActiveAt));
    return rows.map(toUserProfile);
  } catch (error) {
    console.error('Failed to list users:', error);
    throw new Error('Unable to load workspace members.', { cause: error });
  }
}

export async function updateUserRole(targetUserId: number, newRole: UserRole): Promise<UserProfile> {
  try {
    const targetRows = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (targetRows.length === 0) {
      throw new Error('User not found.');
    }

    if (targetRows[0].role === 'admin' && newRole !== 'admin') {
      const adminCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.role, 'admin'));
      if ((adminCount[0]?.count ?? 0) <= 1) {
        throw new Error('Cannot demote the last remaining Admin in the workspace.');
      }
    }

    const [updated] = await db
      .update(users)
      .set({ role: newRole })
      .where(eq(users.id, targetUserId))
      .returning();

    return toUserProfile(updated);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('last remaining Admin') || error.message.includes('not found'))) {
      throw error;
    }
    console.error('Failed to update user role:', error);
    throw new Error('Unable to update member role.', { cause: error });
  }
}

export async function listAuditLogs(limit = 60): Promise<AuditLogItem[]> {
  try {
    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      userEmail: r.userEmail,
      action: r.action,
      resourceSummary: r.resourceSummary,
      collectionScope: r.collectionScope,
      topScore: r.topScore ?? null,
      citationCount: r.citationCount ?? null,
      latencyMs: r.latencyMs ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Failed to list audit logs:', error);
    throw new Error('Unable to load audit activity.', { cause: error });
  }
}

export async function getWorkspaceOverviewStats(userRole: UserRole) {
  try {
    const cols = await listAccessibleCollections(userRole);
    const totalDocuments = cols.reduce((acc, c) => acc + c.documentCount, 0);
    const totalChunks = cols.reduce((acc, c) => acc + c.chunkCount, 0);
    return {
      collectionCount: cols.length,
      documentCount: totalDocuments,
      chunkCount: totalChunks,
    };
  } catch (error) {
    console.error('Failed to compute overview stats:', error);
    return { collectionCount: 0, documentCount: 0, chunkCount: 0 };
  }
}
