import React from 'react';
import {interpolate, spring, useVideoConfig} from 'remotion';

interface DocumentDraftProps {
  frame: number;
  startFrame: number;
}

const documentLines = [
  '# Vector Database Research — 2026-05-03',
  '',
  'Context: Evaluating options for v1 vector storage.',
  '',
  '## Options Considered',
  '',
  '| Option   | Cost    | Scale       | Verdict         |',
  '|----------|---------|-------------|-----------------|',
  '| pgvector | Free    | ~1M vectors | Tested, works   |',
  '| Pinecone | $70/mo  | >10M vectors| Overkill for v1 |',
  '| Weaviate | Free    | Unlimited   | Too complex     |',
  '',
  '## Decision',
  '',
  'Start with pgvector. Revisit when >1M vectors.',
  '',
  '## Evidence',
  '',
  '• 14:32 — pgvector docs (Browser)',
  '• 14:52 — Local test succeeded (Terminal)',
  '• 15:03 — Team confirmed approach (Slack)',
];

export const DocumentDraft: React.FC<DocumentDraftProps> = ({
  frame,
  startFrame,
}) => {
  const {fps} = useVideoConfig();

  // Calculate when each line starts
  const lineStartFrames: number[] = [];
  let currentFrame = startFrame + 20;

  documentLines.forEach(() => {
    lineStartFrames.push(currentFrame);
    currentFrame += 8; // 8 frames per line
  });

  const lastLineStart = currentFrame - 8;
  const documentEndFrame = lastLineStart + 12;

  // Fade in for the "drafting" indicator
  const draftingStart = startFrame;
  const draftingOpacity = interpolate(
    frame,
    [draftingStart, draftingStart + 12],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Show drafting indicator briefly, then document
  const showDocument = frame >= startFrame + 30;

  return (
    <div style={{marginTop: 32}}>
      {/* Drafting indicator */}
      {!showDocument && (
        <div
          style={{
            opacity: draftingOpacity,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 20,
            color: '#7a6e66',
            fontStyle: 'italic',
          }}
        >
          Drafting document from gathered evidence...
        </div>
      )}

      {/* Document */}
      {showDocument && (
        <div
          style={{
            background: '#faf7f2',
            border: '1px solid #d4c9b5',
            borderRadius: 8,
            padding: '24px 28px',
            fontFamily: "'Spectral', Georgia, serif",
            fontSize: 19,
            lineHeight: 1.6,
            color: '#1a1612',
            boxShadow: '0 2px 8px rgba(26, 22, 18, 0.06)',
          }}
        >
          {documentLines.map((line, lineIndex) => {
            const lineStart = lineStartFrames[lineIndex];
            const lineOpacity = interpolate(
              frame,
              [lineStart, lineStart + 8],
              [0, 1],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              },
            );

            const isHeader = line.startsWith('#');
            const isTableRow = line.startsWith('|');
            const isTableSeparator = line.startsWith('|-');
            const isEmpty = line === '';

            if (isEmpty) {
              return <div key={lineIndex} style={{height: 8}} />;
            }

            return (
              <div
                key={lineIndex}
                style={{
                  opacity: lineOpacity,
                  marginBottom: isHeader ? 8 : 2,
                  fontWeight: isHeader ? 600 : undefined,
                  fontSize: isHeader ? 22 : 19,
                  color: isHeader ? '#1a1612' : isTableRow ? '#3d3530' : '#1a1612',
                  fontFamily: isTableRow
                    ? "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace"
                    : undefined,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {line}
              </div>
            );
          })}

          {/* Saved indicator */}
          {frame >= documentEndFrame + 20 && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid #d4c9b5',
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 15,
                color: '#5c6b3a',
                opacity: interpolate(
                  frame,
                  [documentEndFrame + 20, documentEndFrame + 32],
                  [0, 1],
                  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
                ),
              }}
            >
              ✓ Saved to ~/notes/vector-db-research-2026-05-03.md
            </div>
          )}
        </div>
      )}
    </div>
  );
};
