import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderPlus,
  Loader2,
  Upload,
} from 'lucide-react';
import { chunkDocumentText } from '../lib/chunking.ts';
import { createCollectionApi, uploadDocumentApi } from '../lib/api.ts';
import type {
  ChunkStrategy,
  CollectionItem,
  DocumentItem,
  UserRole,
} from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';

interface IngestionWorkbenchViewProps {
  userRole: UserRole;
  collections: CollectionItem[];
  onCollectionsChanged: () => Promise<void>;
  onDocumentUploaded: (doc: DocumentItem) => Promise<void>;
  onInspectDocument: (documentId: number) => void;
}

const STRATEGIES: Array<{ id: ChunkStrategy; label: string; description: string }> = [
  {
    id: 'recursive',
    label: 'Recursive Paragraph',
    description: 'Preserves paragraph and sentence boundaries with sliding overlap.',
  },
  {
    id: 'markdown',
    label: 'Markdown Headings',
    description: 'Splits by section headings (#–####) and attaches heading metadata.',
  },
  {
    id: 'csv_rows',
    label: 'CSV Row Groups',
    description: 'Repeats column schema on every chunk so tabular queries stay grounded.',
  },
  {
    id: 'fixed',
    label: 'Fixed Character Window',
    description: 'Uniform sliding character windows snapped to word boundaries.',
  },
];

export function IngestionWorkbenchView({
  userRole,
  collections,
  onCollectionsChanged,
  onDocumentUploaded,
  onInspectDocument,
}: IngestionWorkbenchViewProps) {
  const canEdit = hasRoleAccess(userRole, 'editor');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRawText, setPreviewRawText] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [collectionId, setCollectionId] = useState<number>(collections[0]?.id ?? 0);
  const [strategy, setStrategy] = useState<ChunkStrategy>('recursive');
  const [chunkSize, setChunkSize] = useState(900);
  const [chunkOverlap, setChunkOverlap] = useState(150);
  const [dragActive, setDragActive] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [stageLabel, setStageLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<{
    document: DocumentItem;
    latencyMs: number;
  } | null>(null);

  // Inline create collection state
  const [showNewCol, setShowNewCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [newColMinRole, setNewColMinRole] = useState<UserRole>('viewer');
  const [creatingCol, setCreatingCol] = useState(false);

  const effectiveCollectionId =
    collections.some((c) => c.id === collectionId) ? collectionId : collections[0]?.id ?? 0;

  const handleFileChosen = async (file: File | null) => {
    setErrorMsg(null);
    setLastUploaded(null);
    if (!file) {
      setSelectedFile(null);
      setPreviewRawText(null);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'md', 'markdown', 'txt', 'csv'].includes(ext)) {
      setErrorMsg('Unsupported file type. Please choose a PDF, Markdown (.md), TXT, or CSV file.');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg('File exceeds the 15 MB upload limit.');
      return;
    }

    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^.]+$/, ''));

    if (ext === 'md' || ext === 'markdown') {
      setStrategy('markdown');
    } else if (ext === 'csv') {
      setStrategy('csv_rows');
    } else {
      setStrategy('recursive');
    }

    if (ext === 'pdf') {
      setPreviewRawText(null);
    } else {
      try {
        const text = await file.text();
        setPreviewRawText(text.slice(0, 60000));
      } catch {
        setPreviewRawText(null);
      }
    }
  };

  const livePreviewChunks = useMemo(() => {
    if (!previewRawText) return [];
    return chunkDocumentText(previewRawText, {
      strategy,
      chunkSize,
      chunkOverlap,
    });
  }, [previewRawText, strategy, chunkSize, chunkOverlap]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !effectiveCollectionId || uploading) return;

    setUploading(true);
    setErrorMsg(null);
    setLastUploaded(null);
    setStageLabel('Extracting text, chunking, and generating embeddings...');

    try {
      const res = await uploadDocumentApi({
        file: selectedFile,
        collectionId: effectiveCollectionId,
        title: title.trim() || selectedFile.name,
        chunkStrategy: strategy,
        chunkSize,
        chunkOverlap,
      });

      setLastUploaded(res);
      setSelectedFile(null);
      setPreviewRawText(null);
      setTitle('');
      await onDocumentUploaded(res.document);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Document ingestion failed.');
    } finally {
      setUploading(false);
      setStageLabel('');
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim() || creatingCol) return;
    setCreatingCol(true);
    setErrorMsg(null);
    try {
      const created = await createCollectionApi({
        name: newColName.trim(),
        description: newColDesc.trim(),
        minRole: newColMinRole,
      });
      await onCollectionsChanged();
      setCollectionId(created.id);
      setNewColName('');
      setNewColDesc('');
      setShowNewCol(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create collection.');
    } finally {
      setCreatingCol(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-lg border border-slate-200 bg-white p-8">
          <h1 className="font-display text-lg font-semibold text-slate-900">
            Editor or Admin access required
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your current role is <strong className="font-semibold text-slate-900">Viewer</strong>. Viewers can query and inspect all permitted collections in the Q&amp;A Studio and Document Catalog, while Editors and Admins manage ingestion pipelines and chunking configurations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50 px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-slate-900">
              Document Ingestion &amp; Chunking Workbench
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload PDF, Markdown, TXT, or CSV documents, tune segmentation boundaries, and index 768-dimensional vectors into PostgreSQL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewCol((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-50"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {showNewCol ? 'Cancel New Collection' : 'New Collection'}
          </button>
        </div>

        {showNewCol && (
          <form
            onSubmit={handleCreateCollection}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Create Knowledge Collection
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Collection Name</label>
                <input
                  type="text"
                  required
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="e.g. Legal & Procurement"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Description</label>
                <input
                  type="text"
                  value={newColDesc}
                  onChange={(e) => setNewColDesc(e.target.value)}
                  placeholder="Scope of documents inside this collection"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Minimum Access Role
                </label>
                <select
                  value={newColMinRole}
                  onChange={(e) => setNewColMinRole(e.target.value as UserRole)}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="viewer">Viewer (All signed-in members)</option>
                  <option value="editor">Editor (Editors &amp; Admins)</option>
                  {userRole === 'admin' && <option value="admin">Admin only</option>}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={creatingCol || newColName.trim().length < 2}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {creatingCol && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Collection
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {lastUploaded && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Indexed <strong>{lastUploaded.document.title}</strong> into{' '}
                <strong>{lastUploaded.document.collectionName}</strong> ·{' '}
                <span className="font-mono tabular-nums">
                  {lastUploaded.document.chunkCount} chunks · {lastUploaded.latencyMs} ms
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => onInspectDocument(lastUploaded.document.id)}
              className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
            >
              Inspect Chunks
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Upload & Chunk Controls */}
          <form
            onSubmit={handleUpload}
            className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7"
          >
            {/* Dropzone */}
            <div>
              <label className="block text-xs font-semibold text-slate-800">
                1. Source Document
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const dropped = e.dataTransfer.files?.[0] ?? null;
                  handleFileChosen(dropped);
                }}
                className={`mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
                }`}
              >
                <Upload className="h-6 w-6 text-slate-400" />
                {selectedFile ? (
                  <div className="mt-2.5">
                    <p className="font-display text-sm font-semibold text-slate-900">
                      {selectedFile.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div className="mt-2.5">
                    <p className="text-sm font-medium text-slate-800">
                      Drop a PDF, Markdown, TXT, or CSV file here
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Maximum file size 15 MB · Parsed in memory on server
                    </p>
                  </div>
                )}
                <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
                  <span>{selectedFile ? 'Choose Different File' : 'Browse Files'}</span>
                  <input
                    type="file"
                    accept=".pdf,.md,.markdown,.txt,.csv"
                    className="sr-only"
                    onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Document Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter display title"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Target Collection
                </label>
                <select
                  value={effectiveCollectionId}
                  onChange={(e) => setCollectionId(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (min: {c.minRole})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Chunking Controls */}
            <div className="space-y-4 border-t border-slate-200 pt-5">
              <div className="text-xs font-semibold text-slate-800">2. Chunking Pipeline</div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {STRATEGIES.map((item) => {
                  const active = strategy === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStrategy(item.id)}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50/50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="font-display text-xs font-semibold text-slate-900">
                        {item.label}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-5 pt-1 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="ingest-size" className="font-medium text-slate-700">
                      Chunk Size (characters)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {chunkSize}
                    </span>
                  </div>
                  <input
                    id="ingest-size"
                    type="range"
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
                    <label htmlFor="ingest-overlap" className="font-medium text-slate-700">
                      Overlap (characters)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {chunkOverlap}
                    </span>
                  </div>
                  <input
                    id="ingest-overlap"
                    type="range"
                    min={0}
                    max={Math.min(400, Math.floor(chunkSize * 0.45))}
                    step={25}
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                    className="mt-1.5 w-full accent-blue-700"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-5">
              <div className="text-xs text-slate-500">
                {uploading ? (
                  <span className="inline-flex items-center gap-2 text-blue-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {stageLabel}
                  </span>
                ) : (
                  'Embeddings generated server-side via Gemini Embedding 2 (768-d)'
                )}
              </div>
              <button
                type="submit"
                disabled={!selectedFile || !effectiveCollectionId || uploading}
                className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-5 py-2.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Ingest &amp; Index Document
              </button>
            </div>
          </form>

          {/* Right: Live Chunk Segmentation Preview */}
          <div className="flex flex-col rounded-lg border border-slate-200 bg-white lg:col-span-5">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Live Chunk Segmentation Preview
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {livePreviewChunks.length > 0 ? (
                  <span className="font-mono tabular-nums">
                    {livePreviewChunks.length} chunks estimated · avg{' '}
                    {Math.round(
                      livePreviewChunks.reduce((s, c) => s + c.tokenEstimate, 0) /
                        livePreviewChunks.length
                    )}{' '}
                    tokens/chunk
                  </span>
                ) : selectedFile?.name.toLowerCase().endsWith('.pdf') ? (
                  'PDF text extraction runs server-side upon ingestion'
                ) : (
                  'Select a Markdown, TXT, or CSV file to inspect live splits'
                )}
              </p>
            </div>

            <div className="max-h-[540px] flex-1 overflow-y-auto divide-y divide-slate-100">
              {livePreviewChunks.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <FileText className="h-6 w-6 text-slate-300" />
                  <p className="mt-2.5 text-xs text-slate-500">
                    Adjust chunk strategy, size, and overlap to preview how boundaries split before writing vectors to PostgreSQL.
                  </p>
                </div>
              ) : (
                livePreviewChunks.slice(0, 12).map((chunk) => (
                  <div key={chunk.chunkIndex} className="px-5 py-3.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        Chunk #{chunk.chunkIndex + 1}
                        {chunk.sectionHeading ? ` · ${chunk.sectionHeading}` : ''}
                      </span>
                      <span className="font-mono tabular-nums">
                        {chunk.charCount} chars · ~{chunk.tokenEstimate} tok
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                      {chunk.content}
                    </p>
                  </div>
                ))
              )}
              {livePreviewChunks.length > 12 && (
                <div className="px-5 py-3 text-center font-mono text-xs text-slate-500 tabular-nums">
                  + {livePreviewChunks.length - 12} additional chunks
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
