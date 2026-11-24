import type { ChunkStrategy } from '../types/rag.ts';

export interface ChunkingOptions {
  strategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
}

export interface GeneratedChunk {
  chunkIndex: number;
  sectionHeading: string;
  content: string;
  charCount: number;
  tokenEstimate: number;
}

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(Math.max(words * 1.33, text.length / 4)));
}

function clampOptions(opts: ChunkingOptions): ChunkingOptions {
  const chunkSize = Math.max(200, Math.min(3000, Math.round(opts.chunkSize || 900)));
  const maxOverlap = Math.floor(chunkSize * 0.45);
  const chunkOverlap = Math.max(0, Math.min(maxOverlap, Math.round(opts.chunkOverlap || 0)));
  return {
    strategy: opts.strategy || 'recursive',
    chunkSize,
    chunkOverlap,
  };
}

function splitFixedWindow(text: string, chunkSize: number, overlap: number, heading = ''): GeneratedChunk[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const chunks: GeneratedChunk[] = [];
  let start = 0;
  const step = Math.max(1, chunkSize - overlap);

  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + chunkSize);
    if (end < cleaned.length) {
      const boundary = cleaned.lastIndexOf(' ', end);
      if (boundary > start + chunkSize * 0.65) {
        end = boundary;
      }
    }
    const slice = cleaned.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({
        chunkIndex: chunks.length,
        sectionHeading: heading,
        content: slice,
        charCount: slice.length,
        tokenEstimate: estimateTokens(slice),
      });
    }
    if (end >= cleaned.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function splitRecursive(text: string, chunkSize: number, overlap: number, heading = ''): GeneratedChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= chunkSize) {
      pieces.push(para);
    } else {
      const sentences = para.split(/(?<=[.!?])\s+/);
      let current = '';
      for (const sentence of sentences) {
        if (sentence.length > chunkSize) {
          if (current) {
            pieces.push(current.trim());
            current = '';
          }
          const subChunks = splitFixedWindow(sentence, chunkSize, 0);
          for (const sub of subChunks) pieces.push(sub.content);
        } else if ((current ? current.length + 1 : 0) + sentence.length > chunkSize) {
          if (current) pieces.push(current.trim());
          current = sentence;
        } else {
          current = current ? `${current} ${sentence}` : sentence;
        }
      }
      if (current.trim()) pieces.push(current.trim());
    }
  }

  const rawChunks: string[] = [];
  let buffer = '';

  for (const piece of pieces) {
    const candidate = buffer ? `${buffer}\n\n${piece}` : piece;
    if (candidate.length <= chunkSize) {
      buffer = candidate;
    } else {
      if (buffer) {
        rawChunks.push(buffer.trim());
        const tail = overlap > 0 ? buffer.slice(Math.max(0, buffer.length - overlap)).trim() : '';
        buffer = tail && tail.length + piece.length + 2 <= chunkSize ? `${tail}\n\n${piece}` : piece;
      } else {
        rawChunks.push(piece.trim());
        buffer = '';
      }
    }
  }
  if (buffer.trim()) {
    rawChunks.push(buffer.trim());
  }

  return rawChunks.map((content, idx) => ({
    chunkIndex: idx,
    sectionHeading: heading,
    content,
    charCount: content.length,
    tokenEstimate: estimateTokens(content),
  }));
}

function splitMarkdownHeadings(text: string, chunkSize: number, overlap: number): GeneratedChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = 'Overview';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.join('\n').trim()) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join('\n').trim(),
        });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.join('\n').trim()) {
    sections.push({
      heading: currentHeading,
      body: currentLines.join('\n').trim(),
    });
  }

  const output: GeneratedChunk[] = [];
  for (const section of sections) {
    const subChunks = splitRecursive(section.body, chunkSize, overlap, section.heading);
    for (const sub of subChunks) {
      output.push({
        ...sub,
        chunkIndex: output.length,
        sectionHeading: section.heading,
      });
    }
  }
  return output;
}

function splitCsvRows(text: string, chunkSize: number, overlap: number): GeneratedChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 1) {
    return splitRecursive(normalized, chunkSize, overlap, 'CSV Records');
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);
  const chunks: GeneratedChunk[] = [];
  let currentRows: string[] = [];
  let currentLength = headerLine.length + 1;
  let startRow = 1;

  const flush = (endRow: number) => {
    if (currentRows.length === 0) return;
    const content = [headerLine, ...currentRows].join('\n');
    chunks.push({
      chunkIndex: chunks.length,
      sectionHeading: `Rows ${startRow}–${endRow}`,
      content,
      charCount: content.length,
      tokenEstimate: estimateTokens(content),
    });
  };

  for (let i = 0; i < dataLines.length; i++) {
    const row = dataLines[i];
    if (currentRows.length > 0 && currentLength + row.length + 1 > chunkSize) {
      flush(startRow + currentRows.length - 1);
      const overlapRowsCount = overlap > 0 ? Math.min(currentRows.length, Math.max(1, Math.floor(overlap / 120))) : 0;
      const carried = overlapRowsCount > 0 ? currentRows.slice(-overlapRowsCount) : [];
      startRow = i + 1 - carried.length;
      currentRows = [...carried, row];
      currentLength = headerLine.length + 1 + currentRows.reduce((sum, r) => sum + r.length + 1, 0);
    } else {
      currentRows.push(row);
      currentLength += row.length + 1;
    }
  }
  flush(startRow + currentRows.length - 1);

  return chunks;
}

export function chunkDocumentText(text: string, options: ChunkingOptions): GeneratedChunk[] {
  const safe = clampOptions(options);
  switch (safe.strategy) {
    case 'fixed':
      return splitFixedWindow(text, safe.chunkSize, safe.chunkOverlap);
    case 'markdown':
      return splitMarkdownHeadings(text, safe.chunkSize, safe.chunkOverlap);
    case 'csv_rows':
      return splitCsvRows(text, safe.chunkSize, safe.chunkOverlap);
    case 'recursive':
    default:
      return splitRecursive(text, safe.chunkSize, safe.chunkOverlap);
  }
}
