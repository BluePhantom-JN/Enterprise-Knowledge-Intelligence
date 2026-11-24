import 'dotenv/config';
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { requireAuth, requireRole, AuthRequest } from './src/middleware/auth.ts';
import {
  appendChatMessage,
  createChatSession,
  createCollection,
  createDocumentWithChunks,
  deleteCollectionById,
  deleteDocumentById,
  deleteSessionById,
  ensureDefaultCollections,
  getDocumentRawForReindex,
  getDocumentWithChunks,
  getWorkspaceOverviewStats,
  hybridSearchChunks,
  listAccessibleCollections,
  listAccessibleDocuments,
  listAllUsers,
  listAuditLogs,
  listSessionMessages,
  listUserSessions,
  replaceDocumentChunks,
  updateUserRole,
  writeAuditLog,
} from './src/db/repository.ts';
import { chunkDocumentText } from './src/lib/chunking.ts';
import { detectFileType, extractDocumentContent } from './src/server/parser.ts';
import { embedQuery, embedTexts, GENERATION_MODEL, getGeminiClient } from './src/lib/gemini.ts';
import { SAMPLE_ENTERPRISE_DOCUMENTS } from './src/server/sampleCorpus.ts';
import type { ChunkStrategy, RetrievalConfig, UserRole } from './src/types/rag.ts';
import { hasRoleAccess } from './src/types/rag.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '4mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max per enterprise document
  },
});

const VALID_STRATEGIES: ChunkStrategy[] = ['recursive', 'fixed', 'markdown', 'csv_rows'];
const VALID_ROLES: UserRole[] = ['viewer', 'editor', 'admin'];

function parsePositiveInt(val: unknown): number | null {
  const num = Number(val);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

// Health check (public, minimal)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Current user profile + accessible stats
app.get('/api/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.appUser!;
    await ensureDefaultCollections(user.id);
    const stats = await getWorkspaceOverviewStats(user.role);
    res.json({ user, stats });
  } catch (error) {
    console.error('GET /api/me failed:', error);
    res.status(500).json({ error: 'Failed to load workspace profile.' });
  }
});

// Collections
app.get('/api/collections', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.appUser!;
    await ensureDefaultCollections(user.id);
    const items = await listAccessibleCollections(user.role);
    res.json({ collections: items });
  } catch (error) {
    console.error('GET /api/collections failed:', error);
    res.status(500).json({ error: 'Failed to load collections.' });
  }
});

app.post(
  '/api/collections',
  requireAuth,
  requireRole('editor'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.appUser!;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const requestedMinRole = req.body?.minRole as UserRole;
      const minRole: UserRole = VALID_ROLES.includes(requestedMinRole)
        ? requestedMinRole
        : 'viewer';

      if (name.length < 2 || name.length > 80) {
        res.status(400).json({ error: 'Collection name must be between 2 and 80 characters.' });
        return;
      }

      if (!hasRoleAccess(user.role, minRole)) {
        res.status(403).json({ error: 'Cannot create a collection above your own access level.' });
        return;
      }

      const created = await createCollection({
        name,
        description,
        minRole,
        createdBy: user.id,
      });

      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'collection_create',
        resourceSummary: `Created collection "${created.name}" (min role: ${created.minRole})`,
        collectionScope: created.name,
      });

      res.status(201).json({ collection: created });
    } catch (error) {
      console.error('POST /api/collections failed:', error);
      res.status(500).json({ error: 'Failed to create collection.' });
    }
  }
);

app.delete(
  '/api/collections/:id',
  requireAuth,
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid collection ID.' });
        return;
      }
      const deleted = await deleteCollectionById(id);
      if (!deleted) {
        res.status(404).json({ error: 'Collection not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (error) {
      console.error('DELETE /api/collections/:id failed:', error);
      res.status(500).json({ error: 'Failed to delete collection.' });
    }
  }
);

// Documents catalog
app.get('/api/documents', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.appUser!;
    const collectionId = req.query.collectionId ? parsePositiveInt(req.query.collectionId) : undefined;
    const fileType = typeof req.query.fileType === 'string' ? req.query.fileType : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const docs = await listAccessibleDocuments(user.role, {
      collectionId: collectionId ?? undefined,
      fileType,
      search,
    });
    res.json({ documents: docs });
  } catch (error) {
    console.error('GET /api/documents failed:', error);
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

// Upload & index multi-format document (PDF, MD, TXT, CSV)
app.post(
  '/api/documents/upload',
  requireAuth,
  requireRole('editor'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    const startedAt = Date.now();
    try {
      const user = req.appUser!;
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select a file to upload (PDF, MD, TXT, or CSV).' });
        return;
      }

      const fileType = detectFileType(file.originalname);
      if (!fileType) {
        res.status(400).json({
          error: 'Unsupported file format. Accepted formats: PDF, Markdown (.md), TXT, and CSV.',
        });
        return;
      }

      const collectionId = parsePositiveInt(req.body?.collectionId);
      if (!collectionId) {
        res.status(400).json({ error: 'Please choose a valid target collection.' });
        return;
      }

      const accessibleCols = await listAccessibleCollections(user.role);
      const targetCol = accessibleCols.find((c) => c.id === collectionId);
      if (!targetCol) {
        res.status(403).json({ error: 'You do not have access to the selected collection.' });
        return;
      }

      const requestedStrategy = req.body?.chunkStrategy as ChunkStrategy;
      const chunkStrategy: ChunkStrategy = VALID_STRATEGIES.includes(requestedStrategy)
        ? requestedStrategy
        : fileType === 'csv'
          ? 'csv_rows'
          : fileType === 'md'
            ? 'markdown'
            : 'recursive';

      const chunkSize = Math.max(250, Math.min(2500, Number(req.body?.chunkSize) || 900));
      const chunkOverlap = Math.max(
        0,
        Math.min(Math.floor(chunkSize * 0.45), Number(req.body?.chunkOverlap) || 150)
      );

      const extractedText = await extractDocumentContent(file.buffer, fileType);
      if (!extractedText || extractedText.length < 15) {
        res.status(400).json({
          error: 'No readable text could be extracted from this file. Please check the file contents.',
        });
        return;
      }

      const chunks = chunkDocumentText(extractedText, {
        strategy: chunkStrategy,
        chunkSize,
        chunkOverlap,
      });

      if (chunks.length === 0) {
        res.status(400).json({ error: 'Document produced zero indexable chunks.' });
        return;
      }

      if (chunks.length > 250) {
        res.status(400).json({
          error: `Document produced ${chunks.length} chunks (limit 250 per upload). Increase chunk size and try again.`,
        });
        return;
      }

      const textsToEmbed = chunks.map((c) =>
        c.sectionHeading ? `${c.sectionHeading}\n\n${c.content}` : c.content
      );
      const embeddings = await embedTexts(textsToEmbed);

      const title =
        typeof req.body?.title === 'string' && req.body.title.trim().length > 0
          ? req.body.title.trim().slice(0, 140)
          : file.originalname.replace(/\.[^.]+$/, '');

      const savedDoc = await createDocumentWithChunks({
        collectionId,
        title,
        fileName: file.originalname,
        fileType,
        fileSizeBytes: file.size,
        rawContent: extractedText,
        chunkStrategy,
        chunkSize,
        chunkOverlap,
        uploadedBy: user.id,
        chunks,
        embeddings,
      });

      const latencyMs = Date.now() - startedAt;
      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'document_upload',
        resourceSummary: `Indexed "${savedDoc.title}" (${savedDoc.fileType.toUpperCase()}, ${savedDoc.chunkCount} chunks, ${chunkStrategy})`,
        collectionScope: targetCol.name,
        latencyMs,
      });

      res.status(201).json({ document: savedDoc, latencyMs });
    } catch (error) {
      console.error('POST /api/documents/upload failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to ingest document.';
      res.status(500).json({ error: msg });
    }
  }
);

// One-click live sample enterprise corpus ingestion (real chunking + Gemini embeddings + pgvector)
app.post(
  '/api/documents/seed-sample',
  requireAuth,
  requireRole('editor'),
  async (req: AuthRequest, res: Response) => {
    const startedAt = Date.now();
    try {
      const user = req.appUser!;
      await ensureDefaultCollections(user.id);
      const accessibleCols = await listAccessibleCollections(user.role);
      const existingDocs = await listAccessibleDocuments(user.role);
      const existingFileNames = new Set(existingDocs.map((d) => d.fileName));

      const createdDocs = [];
      for (const spec of SAMPLE_ENTERPRISE_DOCUMENTS) {
        if (existingFileNames.has(spec.fileName)) continue;

        const targetCol =
          accessibleCols.find((c) => c.slug === spec.collectionSlug) ?? accessibleCols[0];
        if (!targetCol) continue;

        const chunks = chunkDocumentText(spec.content, {
          strategy: spec.chunkStrategy,
          chunkSize: spec.chunkSize,
          chunkOverlap: spec.chunkOverlap,
        });

        const embeddings = await embedTexts(
          chunks.map((c) => (c.sectionHeading ? `${c.sectionHeading}\n\n${c.content}` : c.content))
        );

        const doc = await createDocumentWithChunks({
          collectionId: targetCol.id,
          title: spec.title,
          fileName: spec.fileName,
          fileType: spec.fileType,
          fileSizeBytes: Buffer.byteLength(spec.content, 'utf-8'),
          rawContent: spec.content,
          chunkStrategy: spec.chunkStrategy,
          chunkSize: spec.chunkSize,
          chunkOverlap: spec.chunkOverlap,
          uploadedBy: user.id,
          chunks,
          embeddings,
        });
        createdDocs.push(doc);
      }

      const latencyMs = Date.now() - startedAt;
      if (createdDocs.length > 0) {
        await writeAuditLog({
          userId: user.id,
          userEmail: user.email,
          action: 'document_upload',
          resourceSummary: `Indexed ${createdDocs.length} sample enterprise documents via live embedding pipeline`,
          collectionScope: 'Multiple Collections',
          latencyMs,
        });
      }

      res.json({ created: createdDocs, count: createdDocs.length, latencyMs });
    } catch (error) {
      console.error('POST /api/documents/seed-sample failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to index sample corpus.';
      res.status(500).json({ error: msg });
    }
  }
);

// Inspect chunks for a single document
app.get('/api/documents/:id/chunks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid document ID.' });
      return;
    }

    const detail = await getDocumentWithChunks(id, req.appUser!.role);
    if (!detail) {
      res.status(404).json({ error: 'Document not found or access denied.' });
      return;
    }

    res.json(detail);
  } catch (error) {
    console.error('GET /api/documents/:id/chunks failed:', error);
    res.status(500).json({ error: 'Failed to load document chunks.' });
  }
});

// Re-chunk and re-embed an existing document with new parameters
app.post(
  '/api/documents/:id/reindex',
  requireAuth,
  requireRole('editor'),
  async (req: AuthRequest, res: Response) => {
    const startedAt = Date.now();
    try {
      const user = req.appUser!;
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid document ID.' });
        return;
      }

      const rawDoc = await getDocumentRawForReindex(id);
      if (!rawDoc) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }

      const accessibleCols = await listAccessibleCollections(user.role);
      const targetCol = accessibleCols.find((c) => c.id === rawDoc.collectionId);
      if (!targetCol) {
        res.status(403).json({ error: 'You do not have access to this document collection.' });
        return;
      }

      const requestedStrategy = req.body?.chunkStrategy as ChunkStrategy;
      const chunkStrategy: ChunkStrategy = VALID_STRATEGIES.includes(requestedStrategy)
        ? requestedStrategy
        : (rawDoc.chunkStrategy as ChunkStrategy);
      const chunkSize = Math.max(250, Math.min(2500, Number(req.body?.chunkSize) || 900));
      const chunkOverlap = Math.max(
        0,
        Math.min(Math.floor(chunkSize * 0.45), Number(req.body?.chunkOverlap) || 150)
      );

      const chunks = chunkDocumentText(rawDoc.rawContent, {
        strategy: chunkStrategy,
        chunkSize,
        chunkOverlap,
      });

      if (chunks.length === 0 || chunks.length > 250) {
        res.status(400).json({
          error: `Re-chunking produced ${chunks.length} chunks (allowed range: 1–250).`,
        });
        return;
      }

      const embeddings = await embedTexts(
        chunks.map((c) => (c.sectionHeading ? `${c.sectionHeading}\n\n${c.content}` : c.content))
      );

      await replaceDocumentChunks({
        documentId: rawDoc.id,
        collectionId: rawDoc.collectionId,
        chunkStrategy,
        chunkSize,
        chunkOverlap,
        chunks,
        embeddings,
      });

      const latencyMs = Date.now() - startedAt;
      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'document_reindex',
        resourceSummary: `Re-indexed "${rawDoc.title}" → ${chunks.length} chunks (${chunkStrategy}, size ${chunkSize}, overlap ${chunkOverlap})`,
        collectionScope: targetCol.name,
        latencyMs,
      });

      const updated = await getDocumentWithChunks(rawDoc.id, user.role);
      res.json({ ...updated, latencyMs });
    } catch (error) {
      console.error('POST /api/documents/:id/reindex failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to re-index document.';
      res.status(500).json({ error: msg });
    }
  }
);

app.delete(
  '/api/documents/:id',
  requireAuth,
  requireRole('editor'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.appUser!;
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid document ID.' });
        return;
      }

      const detail = await getDocumentWithChunks(id, user.role);
      if (!detail) {
        res.status(404).json({ error: 'Document not found or access denied.' });
        return;
      }

      const title = await deleteDocumentById(id);
      if (!title) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }

      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'document_delete',
        resourceSummary: `Deleted document "${title}"`,
        collectionScope: detail.document.collectionName,
      });

      res.json({ deleted: true });
    } catch (error) {
      console.error('DELETE /api/documents/:id failed:', error);
      res.status(500).json({ error: 'Failed to delete document.' });
    }
  }
);

// Chat Sessions
app.get('/api/sessions', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await listUserSessions(req.appUser!.id);
    res.json({ sessions });
  } catch (error) {
    console.error('GET /api/sessions failed:', error);
    res.status(500).json({ error: 'Failed to load chat sessions.' });
  }
});

app.get('/api/sessions/:id/messages', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    const messages = await listSessionMessages(id, req.appUser!.id);
    if (!messages) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    res.json({ messages });
  } catch (error) {
    console.error('GET /api/sessions/:id/messages failed:', error);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

app.delete('/api/sessions/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    const deleted = await deleteSessionById(id, req.appUser!.id);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/sessions/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete session.' });
  }
});

// Hybrid RAG Query + Streaming Grounded Citations (SSE)
app.post('/api/rag/query', requireAuth, async (req: AuthRequest, res: Response) => {
  const startedAt = Date.now();
  const user = req.appUser!;

  const queryText = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (queryText.length < 2 || queryText.length > 2000) {
    res.status(400).json({ error: 'Query must be between 2 and 2,000 characters.' });
    return;
  }

  const rawSessionId = req.body?.sessionId ? parsePositiveInt(req.body.sessionId) : null;
  const requestedCollectionIds: number[] = Array.isArray(req.body?.collectionIds)
    ? req.body.collectionIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];

  const retrievalConfig: RetrievalConfig = {
    collectionIds: requestedCollectionIds,
    topK: Math.max(3, Math.min(12, Number(req.body?.topK) || 6)),
    semanticWeight: Math.max(0, Math.min(1, req.body?.semanticWeight ?? 0.7)),
    minScore: Math.max(0, Math.min(0.85, req.body?.minScore ?? 0.25)),
  };

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const accessibleCols = await listAccessibleCollections(user.role);
    const accessibleIdSet = new Set(accessibleCols.map((c) => c.id));
    const effectiveCollectionIds =
      retrievalConfig.collectionIds.length > 0
        ? retrievalConfig.collectionIds.filter((id) => accessibleIdSet.has(id))
        : accessibleCols.map((c) => c.id);

    const collectionScopeLabel =
      effectiveCollectionIds.length === accessibleCols.length
        ? 'All Accessible Collections'
        : accessibleCols
            .filter((c) => effectiveCollectionIds.includes(c.id))
            .map((c) => c.name)
            .join(', ') || 'None';

    let sessionId = rawSessionId;
    if (sessionId) {
      const existingMessages = await listSessionMessages(sessionId, user.id);
      if (!existingMessages) {
        sessionId = await createChatSession(user.id, queryText.slice(0, 72));
      }
    } else {
      sessionId = await createChatSession(user.id, queryText.slice(0, 72));
    }

    await appendChatMessage({
      sessionId,
      role: 'user',
      content: queryText,
      retrievalConfig,
    });

    const queryEmbedding = await embedQuery(queryText);
    const citations = await hybridSearchChunks({
      queryText,
      queryEmbedding,
      allowedCollectionIds: effectiveCollectionIds,
      topK: retrievalConfig.topK,
      semanticWeight: retrievalConfig.semanticWeight,
      minScore: retrievalConfig.minScore,
    });

    const retrievalLatencyMs = Date.now() - startedAt;
    sendEvent('meta', {
      sessionId,
      citations,
      retrievalConfig,
      retrievalLatencyMs,
    });

    let fullAnswer = '';

    if (citations.length === 0) {
      fullAnswer =
        'No indexed passages in your accessible collections met the current relevance threshold for this query. Try broadening the collection filter, lowering the minimum relevance score in Retrieval Controls, or indexing relevant documents in the Ingestion Workbench.';
      sendEvent('delta', { text: fullAnswer });
    } else {
      const contextBlock = citations
        .map(
          (c) =>
            `[${c.citationNumber}] Document: "${c.documentTitle}" (${c.fileName}) | Collection: ${c.collectionName}${c.sectionHeading ? ` | Section: ${c.sectionHeading}` : ''} | Chunk #${c.chunkIndex + 1}\n${c.content}`
        )
        .join('\n\n---\n\n');

      const ai = getGeminiClient();
      const stream = await ai.models.generateContentStream({
        model: GENERATION_MODEL,
        contents: `Question:\n${queryText}\n\nRetrieved Enterprise Sources:\n${contextBlock}`,
        config: {
          systemInstruction:
            'You are Meridian Knowledge Studio, a precise enterprise RAG synthesis engine. Answer the user question using ONLY the provided Retrieved Enterprise Sources. Cite every factual claim inline using exact bracketed source numbers like [1] or [2] immediately after the supported statement. Do not invent facts, figures, or citations beyond the provided sources. If the sources only partially answer the question, state clearly what is verified and what is absent. Format clearly with concise paragraphs, bullet points, or Markdown tables where helpful.',
        },
      });

      for await (const chunk of stream) {
        const piece = chunk.text ?? '';
        if (piece) {
          fullAnswer += piece;
          sendEvent('delta', { text: piece });
        }
      }
    }

    const totalLatencyMs = Date.now() - startedAt;
    const savedAssistantMsg = await appendChatMessage({
      sessionId,
      role: 'assistant',
      content: fullAnswer.trim(),
      retrievalConfig,
      citations,
      latencyMs: totalLatencyMs,
    });

    await writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: 'rag_query',
      resourceSummary: queryText.slice(0, 180),
      collectionScope: collectionScopeLabel,
      topScore: citations[0]?.rrfScore ?? 0,
      citationCount: citations.length,
      latencyMs: totalLatencyMs,
    });

    sendEvent('done', {
      sessionId,
      message: savedAssistantMsg,
      latencyMs: totalLatencyMs,
    });
    res.end();
  } catch (error) {
    console.error('POST /api/rag/query failed:', error);
    const msg = error instanceof Error ? error.message : 'RAG synthesis failed.';
    sendEvent('error', { error: msg });
    res.end();
  }
});

// Admin Governance Endpoints
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const members = await listAllUsers();
    res.json({ users: members });
  } catch (error) {
    console.error('GET /api/admin/users failed:', error);
    res.status(500).json({ error: 'Failed to load workspace members.' });
  }
});

app.patch(
  '/api/admin/users/:id/role',
  requireAuth,
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.appUser!;
      const id = parsePositiveInt(req.params.id);
      const role = req.body?.role as UserRole;

      if (!id || !VALID_ROLES.includes(role)) {
        res.status(400).json({ error: 'Valid user ID and role (admin, editor, viewer) required.' });
        return;
      }

      const updated = await updateUserRole(id, role);
      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'role_update',
        resourceSummary: `Updated ${updated.email} role to ${updated.role}`,
        collectionScope: 'Governance',
      });

      res.json({ user: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update role.';
      const status = msg.includes('last remaining Admin') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  }
);

app.get(
  '/api/admin/audit-logs',
  requireAuth,
  requireRole('admin'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const logs = await listAuditLogs(80);
      res.json({ logs });
    } catch (error) {
      console.error('GET /api/admin/audit-logs failed:', error);
      res.status(500).json({ error: 'Failed to load audit activity.' });
    }
  }
);

// Handle multer file size errors cleanly
app.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File exceeds the 15 MB upload limit.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Knowledge Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
