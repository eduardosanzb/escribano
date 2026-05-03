import React from 'react';
import {interpolate, spring, useVideoConfig} from 'remotion';

interface AnswerBlockProps {
  frame: number;
  startFrame: number;
}

const answerLines = [
  "Here's what you found:",
  '',
  'pgvector (Postgres extension)',
  '  • Free, already in your stack',
  '  • Good up to ~1M vectors',
  '  • You tested locally — works',
  '',
  'Pinecone',
  '  • Managed, $70/mo starter',
  '  • Best for >10M vectors',
  '  • You noted: "maybe overkill for v1"',
  '',
  'Weaviate',
  '  • Open source, complex setup',
  '  • You closed the tab after 5 min',
  '',
  'Recommendation: Start with pgvector.',
  'You already proved it works.',
];

const pills = ['Create ADR', 'Share with team', 'Continue research'];

export const AnswerBlock: React.FC<AnswerBlockProps> = ({
  frame,
  startFrame,
}) => {
  const {fps} = useVideoConfig();

  const lineWords = answerLines.map((line) => line.split(' ').filter(Boolean));

  // Calculate when each word starts
  const wordStartFrames: number[][] = [];
  let currentFrame = startFrame + 12;

  lineWords.forEach((words, lineIndex) => {
    const starts: number[] = [];
    words.forEach(() => {
      starts.push(currentFrame);
      currentFrame += 1;
    });
    wordStartFrames.push(starts);
    if (lineIndex < answerLines.length - 1) {
      currentFrame += 4;
    }
  });

  const lastWordStart = currentFrame - 1;
  const textEndFrame = lastWordStart + 6;

  return (
    <div
      style={{
        marginTop: 24,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 15,
        lineHeight: 1.7,
        color: '#1a1612',
      }}
    >
      {lineWords.map((words, lineIndex) => {
        const line = answerLines[lineIndex];
        const isBullet = line.startsWith('  •');
        const isRecommendation = line.startsWith('Recommendation:');
        const isEmpty = line === '';

        if (isEmpty) {
          return <div key={lineIndex}>&nbsp;</div>;
        }

        return (
          <div
            key={lineIndex}
            style={{
              color: isBullet
                ? '#3d3530'
                : isRecommendation
                ? '#b85c38'
                : '#1a1612',
              fontWeight: isRecommendation ? 500 : undefined,
              paddingLeft: isBullet ? 16 : 0,
            }}
          >
            {words.map((word, wordIndex) => {
              const wordStart = wordStartFrames[lineIndex][wordIndex];
              const opacity = interpolate(
                frame,
                [wordStart, wordStart + 6],
                [0, 1],
                {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }
              );

              return (
                <span
                  key={wordIndex}
                  style={{
                    display: 'inline-block',
                    opacity,
                    marginRight: 4,
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        );
      })}

      <div style={{display: 'flex', gap: 12, marginTop: 24}}>
        {pills.map((pill, index) => {
          const delay = index * 12;
          const progress = spring({
            frame: Math.max(0, frame - textEndFrame - delay),
            fps,
            config: {damping: 25, stiffness: 120, mass: 0.6},
          });

          return (
            <div
              key={index}
              style={{
                opacity: progress,
                transform: `scale(${progress})`,
                padding: '8px 16px',
                borderRadius: 20,
                background: '#ede5d4',
                border: '1px solid #d4c9b5',
                color: '#3d3530',
                fontSize: 13,
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              [{pill}]
            </div>
          );
        })}
      </div>
    </div>
  );
};
