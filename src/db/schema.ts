import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('viewer'), // 'admin' | 'editor' | 'viewer'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
});

export const collections = pgTable('collections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  minRole: text('min_role').notNull().default('viewer'), // 'viewer' | 'editor' | 'admin'
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    collectionId: integer('collection_id')
      .references(() => collections.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull(), // 'pdf' | 'md' | 'txt' | 'csv'
    fileSizeBytes: integer('file_size_bytes').notNull().default(0),
    rawContent: text('raw_content').notNull(),
    chunkStrategy: text('chunk_strategy').notNull().default('recursive'), // 'recursive' | 'fixed' | 'markdown' | 'csv_rows'
    chunkSize: integer('chunk_size').notNull().default(900),
    chunkOverlap: integer('chunk_overlap').notNull().default(150),
    chunkCount: integer('chunk_count').notNull().default(0),
    status: text('status').notNull().default('ready'), // 'ready' | 'indexing' | 'failed'
    uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('documents_collection_idx').on(table.collectionId)]
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    collectionId: integer('collection_id')
      .references(() => collections.id, { onDelete: 'cascade' })
      .notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    sectionHeading: text('section_heading').notNull().default(''),
    content: text('content').notNull(),
    charCount: integer('char_count').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('chunks_document_idx').on(table.documentId),
    index('chunks_collection_idx').on(table.collectionId),
    index('chunks_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ]
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('chat_sessions_user_idx').on(table.userId)]
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => chatSessions.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    retrievalConfigJson: text('retrieval_config_json'),
    citationsJson: text('citations_json'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('chat_messages_session_idx').on(table.sessionId)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email').notNull(),
    action: text('action').notNull(),
    resourceSummary: text('resource_summary').notNull(),
    collectionScope: text('collection_scope').notNull().default('All Collections'),
    topScore: real('top_score'),
    citationCount: integer('citation_count'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_created_idx').on(table.createdAt)]
);

export const usersRelations = relations(users, ({ many }) => ({
  collections: many(collections),
  documents: many(documents),
  chatSessions: many(chatSessions),
  auditLogs: many(auditLogs),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  creator: one(users, {
    fields: [collections.createdBy],
    references: [users.id],
  }),
  documents: many(documents),
  chunks: many(documentChunks),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  collection: one(collections, {
    fields: [documents.collectionId],
    references: [collections.id],
  }),
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
  collection: one(collections, {
    fields: [documentChunks.collectionId],
    references: [collections.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [chatSessions.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

export type UserRecord = typeof users.$inferSelect;
export type CollectionRecord = typeof collections.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentChunkRecord = typeof documentChunks.$inferSelect;
export type ChatSessionRecord = typeof chatSessions.$inferSelect;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;
