import React from 'react';
import type { CitationChunk } from '../types/rag.ts';

interface CitedMarkdownProps {
  content: string;
  citations: CitationChunk[];
  activeCitationNumber: number | null;
  onSelectCitation: (citationNumber: number) => void;
}

// XSS-safe inline parser supporting **bold**, `code`, and interactive [1] citation anchors
function renderInlineTokens(
  text: string,
  citations: CitationChunk[],
  activeCitationNumber: number | null,
  onSelectCitation: (n: number) => void
): React.ReactNode[] {
  const citationSet = new Set(citations.map((c) => c.citationNumber));
  const pattern = /(\[\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);

  return parts.map((part, idx) => {
    if (!part) return null;

    const citeMatch = part.match(/^\[(\d+)\]$/);
    if (citeMatch) {
      const num = Number(citeMatch[1]);
      const exists = citationSet.has(num);
      if (!exists) {
        return (
          <span key={idx} className="font-mono text-xs text-slate-500">
            {part}
          </span>
        );
      }
      const isActive = activeCitationNumber === num;
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onSelectCitation(num)}
          title={`Inspect citation source [${num}]`}
          className={`mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
            isActive
              ? 'bg-blue-700 text-white'
              : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
          }`}
        >
          {num}
        </button>
      );
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function CitedMarkdown({
  content,
  citations,
  activeCitationNumber,
  onSelectCitation,
}: CitedMarkdownProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={`code-${i}`}
          className="my-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingClass =
        level === 1
          ? 'mt-5 mb-2 font-display text-lg font-semibold text-slate-900'
          : level === 2
            ? 'mt-4 mb-2 font-display text-base font-semibold text-slate-900'
            : 'mt-3 mb-1.5 font-display text-sm font-semibold text-slate-900';
      blocks.push(
        <h3 key={`h-${i}`} className={headingClass}>
          {renderInlineTokens(text, citations, activeCitationNumber, onSelectCitation)}
        </h3>
      );
      i++;
      continue;
    }

    // Markdown Table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());

      const headers = parseRow(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }

      blocks.push(
        <div key={`tbl-${i}`} className="my-3 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 font-display text-xs font-semibold text-slate-700">
                    {renderInlineTokens(h, citations, activeCitationNumber, onSelectCitation)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/70">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-slate-700 tabular-nums">
                      {renderInlineTokens(cell, citations, activeCitationNumber, onSelectCitation)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-2.5 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-800">
          {items.map((item, idx) => (
            <li key={idx}>
              {renderInlineTokens(item, citations, activeCitationNumber, onSelectCitation)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-2.5 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-800">
          {items.map((item, idx) => (
            <li key={idx}>
              {renderInlineTokens(item, citations, activeCitationNumber, onSelectCitation)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-2.5 text-[15px] leading-[1.65] text-slate-800">
        {renderInlineTokens(paraLines.join(' '), citations, activeCitationNumber, onSelectCitation)}
      </p>
    );
  }

  return <div className="max-w-[68ch]">{blocks}</div>;
}
