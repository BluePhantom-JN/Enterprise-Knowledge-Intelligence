import React, { useEffect, useRef } from 'react';
import { ExternalLink, FileText, Search, X } from 'lucide-react';
import type { CitationChunk, RetrievalConfig } from '../types/rag.ts';

interface RetrievalInspectorProps {
  citations: CitationChunk[];
  activeCitationNumber: number | null;
  queryText: string;
  retrievalConfig: RetrievalConfig | null;
  latencyMs: number | null;
  onSelectCitation: (citationNumber: number) => void;
  onOpenDocumentChunks: (documentId: number) => void;
  onClose: () => void;
}

function highlightQueryTerms(content: string, query: string): React.ReactNode {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  if (terms.length === 0) return content;

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = content.split(regex);

  return parts.map((part, idx) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={idx} className="rounded-sm bg-blue-100 px-0.5 text-slate-900">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

export function RetrievalInspector({
  citations,
  activeCitationNumber,
  queryText,
  retrievalConfig,
  latencyMs,
  onSelectCitation,
  onOpenDocumentChunks,
  onClose,
}: RetrievalInspectorProps) {
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (activeCitationNumber && itemRefs.current[activeCitationNumber]) {
      itemRefs.current[activeCitationNumber]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeCitationNumber]);

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-slate-50/60 lg:w-[390px] lg:shrink-0">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Retrieval Inspector
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {citations.length > 0 ? (
              <span className="font-mono tabular-nums">
                {citations.length} chunks ranked
                {latencyMs !== null ? ` · ${latencyMs} ms` : ''}
              </span>
            ) : (
              'Hybrid semantic & lexical evidence'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Retrieval Inspector"
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {retrievalConfig && citations.length > 0 && (
        <div className="border-b border-slate-200 bg-white px-5 py-2.5 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
            <span>Top-K {retrievalConfig.topK}</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>Semantic {Math.round(retrievalConfig.semanticWeight * 100)}%</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>Lexical {Math.round((1 - retrievalConfig.semanticWeight) * 100)}%</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>Min {retrievalConfig.minScore.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {citations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
              <Search className="h-4 w-4" />
            </div>
            <p className="mt-3 font-display text-sm font-medium text-slate-900">
              No retrieved passages yet
            </p>
            <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">
              Ask a question or click any inline citation anchor to inspect hybrid cosine similarity, lexical rank, and exact source excerpts.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {citations.map((item) => {
              const isSelected = activeCitationNumber === item.citationNumber;
              return (
                <div
                  key={item.chunkId}
                  ref={(el) => {
                    itemRefs.current[item.citationNumber] = el;
                  }}
                  onClick={() => onSelectCitation(item.citationNumber)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCitation(item.citationNumber);
                    }
                  }}
                  className={`cursor-pointer rounded-lg border bg-white p-4 transition-colors ${
                    isSelected
                      ? 'border-blue-600 ring-1 ring-blue-600/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 font-mono text-[11px] font-semibold tabular-nums ${
                            isSelected
                              ? 'bg-blue-700 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          [{item.citationNumber}]
                        </span>
                        <h3 className="truncate font-display text-xs font-semibold text-slate-900">
                          {item.documentTitle}
                        </h3>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{item.collectionName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Chunk #{item.chunkIndex + 1}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="uppercase">{item.fileType}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDocumentChunks(item.documentId);
                      }}
                      title="Open in Chunk Explorer"
                      className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {item.sectionHeading && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                      <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate">{item.sectionHeading}</span>
                    </div>
                  )}

                  {/* Hybrid Score Breakdown */}
                  <div className="mt-3 grid grid-cols-3 gap-2 border-y border-slate-100 py-2.5">
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">Fused RRF</div>
                      <div className="mt-0.5 font-mono text-xs font-semibold text-blue-700 tabular-nums">
                        {item.rrfScore.toFixed(3)}
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-blue-600"
                          style={{ width: `${Math.round(item.rrfScore * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">
                        Semantic{item.semanticRank ? ` #${item.semanticRank}` : ''}
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-medium text-slate-800 tabular-nums">
                        {(item.semanticScore * 100).toFixed(1)}%
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-slate-700"
                          style={{ width: `${Math.round(item.semanticScore * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">
                        Lexical{item.lexicalRank ? ` #${item.lexicalRank}` : ''}
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-medium text-slate-800 tabular-nums">
                        {(item.lexicalScore * 100).toFixed(1)}%
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-slate-500"
                          style={{ width: `${Math.round(item.lexicalScore * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                    {highlightQueryTerms(item.content, queryText)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
