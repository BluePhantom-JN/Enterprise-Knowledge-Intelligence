import React, { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  FileSearch,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { deleteDocumentApi } from '../lib/api.ts';
import type { CollectionItem, DocumentItem, UserRole } from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';

interface DocumentCatalogViewProps {
  userRole: UserRole;
  collections: CollectionItem[];
  documents: DocumentItem[];
  loading: boolean;
  seedingSample: boolean;
  onRefresh: () => Promise<void>;
  onInspectDocument: (documentId: number) => void;
  onNavigateIngestion: () => void;
  onSeedSampleCorpus: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DocumentCatalogView({
  userRole,
  collections,
  documents,
  loading,
  seedingSample,
  onRefresh,
  onInspectDocument,
  onNavigateIngestion,
  onSeedSampleCorpus,
}: DocumentCatalogViewProps) {
  const canEdit = hasRoleAccess(userRole, 'editor');

  const [search, setSearch] = useState('');
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filtered = documents.filter((doc) => {
    if (collectionFilter !== 'all' && String(doc.collectionId) !== collectionFilter) return false;
    if (formatFilter !== 'all' && doc.fileType !== formatFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.fileName.toLowerCase().includes(q) ||
        doc.collectionName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setErrorMsg(null);
    try {
      await deleteDocumentApi(id);
      setConfirmDeleteId(null);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete document.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50 px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Flat single-elevation corpus summary strip */}
        <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-slate-500">Accessible Collections</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {collections.length}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-slate-500">Indexed Documents</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {documents.length}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="text-xs font-medium text-slate-500">Vectorized Chunks</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {totalChunks.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, filename, or collection..."
                className="w-64 rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              aria-label="Filter by collection"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">All Collections</option>
              {collections.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-100 p-0.5">
              {(['all', 'pdf', 'md', 'txt', 'csv'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`rounded px-2.5 py-1 text-xs font-medium uppercase whitespace-nowrap shrink-0 transition-colors ${
                    formatFilter === fmt
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fmt === 'all' ? 'All' : fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-slate-500 font-mono tabular-nums">
            Showing {filtered.length} of {documents.length}
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Document Table */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <div className="divide-y divide-slate-100 p-4">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="flex items-center justify-between py-3">
                  <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <FileSearch className="h-7 w-7 text-slate-300" />
              <p className="mt-3 font-display text-sm font-semibold text-slate-900">
                {documents.length === 0
                  ? 'No documents indexed yet'
                  : 'No documents match your active filters'}
              </p>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                {documents.length === 0
                  ? 'Upload PDF, Markdown, TXT, or CSV documents through the Ingestion Workbench or load our sample enterprise corpus.'
                  : 'Try clearing the search box or switching collection and format filters.'}
              </p>
              {documents.length === 0 && canEdit && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onSeedSampleCorpus}
                    disabled={seedingSample}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 disabled:opacity-60"
                  >
                    {seedingSample ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <BookOpen className="h-3.5 w-3.5" />
                    )}
                    Index Sample Enterprise Corpus
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateIngestion}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Document
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                    <th className="px-4 py-2.5 font-display font-semibold">Document</th>
                    <th className="px-4 py-2.5 font-display font-semibold">Collection</th>
                    <th className="px-4 py-2.5 font-display font-semibold">Chunking Profile</th>
                    <th className="px-4 py-2.5 text-right font-display font-semibold">Chunks</th>
                    <th className="px-4 py-2.5 text-right font-display font-semibold">Updated</th>
                    <th className="px-4 py-2.5 text-right font-display font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((doc) => (
                    <tr key={doc.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onInspectDocument(doc.id)}
                          className="text-left font-display text-xs font-semibold text-slate-900 hover:text-blue-700"
                        >
                          {doc.title}
                        </button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span className="truncate max-w-[240px]">{doc.fileName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="uppercase">{doc.fileType}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatBytes(doc.fileSizeBytes)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{doc.collectionName}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        {doc.chunkStrategy} · {doc.chunkSize}/{doc.chunkOverlap}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-slate-900 tabular-nums">
                        {doc.chunkCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500 tabular-nums whitespace-nowrap">
                        {formatDate(doc.updatedAt)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {confirmDeleteId === doc.id ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDelete(doc.id)}
                              disabled={deletingId === doc.id}
                              className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {deletingId === doc.id ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] text-slate-500 hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => onInspectDocument(doc.id)}
                              className="font-medium text-blue-700 hover:text-blue-900"
                            >
                              Inspect Chunks
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(doc.id)}
                                aria-label={`Delete ${doc.title}`}
                                className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
