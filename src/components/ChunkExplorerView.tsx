import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { fetchDocumentChunks, reindexDocumentApi } from '../lib/api.ts';
import type {
  ChunkStrategy,
  DocumentChunkItem,
  DocumentItem,
  UserRole,
} from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';

interface ChunkExplorerViewProps {
  documentId: number;
  userRole: UserRole;
  onBack: () => void;
  onReindexed: () => Promise<void>;
}

export function ChunkExplorerView({
  documentId,
  userRole,
  onBack,
  onReindexed,
}: ChunkExplorerViewProps) {
  const canEdit = hasRoleAccess(userRole, 'editor');

  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [rawLength, setRawLength] = useState(0);
  const [chunks, setChunks] = useState<DocumentChunkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chunkSearch, setChunkSearch] = useState('');

  // Re-chunk controls
  const [strategy, setStrategy] = useState<ChunkStrategy>('recursive');
  const [chunkSize, setChunkSize] = useState(900);
  const [chunkOverlap, setChunkOverlap] = useState(150);
  const [reindexing, setReindexing] = useState(false);
  const [reindexSuccess, setReindexSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    setReindexSuccess(null);

    fetchDocumentChunks(documentId)
      .then((res) => {
        if (!active) return;
        setDoc(res.document);
        setRawLength(res.rawContentLength);
        setChunks(res.chunks);
        setStrategy(res.document.chunkStrategy);
        setChunkSize(res.document.chunkSize);
        setChunkOverlap(res.document.chunkOverlap);
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load document chunks.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [documentId]);

  const handleReindex = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || reindexing) return;
    setReindexing(true);
    setErrorMsg(null);
    setReindexSuccess(null);

    try {
      const updated = await reindexDocumentApi(doc.id, {
        chunkStrategy: strategy,
        chunkSize,
        chunkOverlap,
      });
      setDoc(updated.document);
      setChunks(updated.chunks);
      setReindexSuccess(
        `Re-indexed into ${updated.chunks.length} chunks in ${updated.latencyMs} ms.`
      );
      await onReindexed();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Re-indexing failed.');
    } finally {
      setReindexing(false);
    }
  };

  const filteredChunks = chunkSearch.trim()
    ? chunks.filter(
        (c) =>
          c.content.toLowerCase().includes(chunkSearch.trim().toLowerCase()) ||
          c.sectionHeading.toLowerCase().includes(chunkSearch.trim().toLowerCase())
      )
    : chunks;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/50">
        <Loader2 className="h-5 w-5 animate-spin text-blue-700" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Document Catalog
        </button>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          {errorMsg || 'Document could not be loaded.'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50 px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Catalog
            </button>
            <h1 className="mt-2 font-display text-xl font-semibold text-slate-900">{doc.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{doc.collectionName}</span>
              <span aria-hidden="true">·</span>
              <span>{doc.fileName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{rawLength.toLocaleString()} chars</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{chunks.length} indexed chunks</span>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={chunkSearch}
              onChange={(e) => setChunkSearch(e.target.value)}
              placeholder="Filter chunks by text..."
              className="w-60 rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {reindexSuccess && (
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{reindexSuccess}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Chunk Stream */}
          <div className="space-y-3 lg:col-span-8">
            {filteredChunks.map((chunk) => (
              <div
                key={chunk.id}
                className="rounded-lg border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-blue-700 tabular-nums">
                      Chunk #{chunk.chunkIndex + 1}
                    </span>
                    {chunk.sectionHeading && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-medium text-slate-700">{chunk.sectionHeading}</span>
                      </>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {chunk.charCount} chars · ~{chunk.tokenEstimate} tokens
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
                  {chunk.content}
                </p>
              </div>
            ))}
          </div>

          {/* Re-chunk & Re-index Sidebar */}
          <div className="lg:col-span-4">
            <form
              onSubmit={handleReindex}
              className="sticky top-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5"
            >
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Chunking Parameters
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {canEdit
                    ? 'Tune segmentation and regenerate pgvector embeddings from stored text.'
                    : 'Read-only view of current indexing parameters.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Strategy</label>
                <select
                  disabled={!canEdit || reindexing}
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as ChunkStrategy)}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="recursive">Recursive Paragraph</option>
                  <option value="markdown">Markdown Headings</option>
                  <option value="csv_rows">CSV Row Groups</option>
                  <option value="fixed">Fixed Character Window</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-slate-700">Chunk Size</label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {chunkSize} chars
                  </span>
                </div>
                <input
                  type="range"
                  disabled={!canEdit || reindexing}
                  min={300}
                  max={2000}
                  step={50}
                  value={chunkSize}
                  onChange={(e) => {
                    const nextSize = Number(e.target.value);
                    setChunkSize(nextSize);
                    if (chunkOverlap > Math.floor(nextSize * 0.45)) {
                      setChunkOverlap(Math.floor(nextSize * 0.4));
                    }
                  }}
                  className="mt-1.5 w-full accent-blue-700"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-slate-700">Overlap</label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {chunkOverlap} chars
                  </span>
                </div>
                <input
                  type="range"
                  disabled={!canEdit || reindexing}
                  min={0}
                  max={Math.min(400, Math.floor(chunkSize * 0.45))}
                  step={25}
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  className="mt-1.5 w-full accent-blue-700"
                />
              </div>

              {canEdit && (
                <button
                  type="submit"
                  disabled={reindexing}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
                >
                  {reindexing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Re-chunking &amp; Embedding...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Re-chunk &amp; Re-index Document
                    </>
                  )}
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
