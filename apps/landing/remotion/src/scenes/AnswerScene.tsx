import React from 'react';
import {staticFile, Img, useCurrentFrame, interpolate} from 'remotion';
import {enterExit, soft, float} from '../motion';

const colors = {
  ink: '#E8E9EE',
  inkSoft: '#9395A5',
  inkMuted: '#5C5F72',
  bg: '#0E0F14',
  surface: '#15171F',
  elevated: '#1C1F2B',
  line: '#2A2D3A',
  amber: '#E8A838',
  olive: '#4A9E7A',
  rust: '#B85C38',
  blue: '#314573',
};

const serif = "'Cormorant Garamond', Georgia, serif";
const body = "'Spectral', Georgia, serif";
const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'SF Mono', SFMono-Regular, Menlo, monospace";

const Label: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      fontFamily: sans,
      fontSize: 21,
      letterSpacing: 4,
      textTransform: 'uppercase',
      color: colors.inkMuted,
      ...style,
    }}
  >
    {children}
  </div>
);

export const AnswerScene: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  const overallOpacity = enterExit(relativeFrame, 0, 25, 120, 150);

  const textProgress = soft((relativeFrame - 10) / 20);
  const titleProgress = soft((relativeFrame - 20) / 20);
  const bodyProgress = soft((relativeFrame - 30) / 20);

  const cardOpacity = enterExit(relativeFrame, 40, 70, 120, 150);

  const line1 = 'sources: 9 moments';
  const line2 = 'confidence: local evidence';
  const line3 = 'artifact: answer.md';

  const line1Chars = Math.floor(
    interpolate(relativeFrame, [50, 70], [0, line1.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const line2Chars = Math.floor(
    interpolate(relativeFrame, [60, 80], [0, line2.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const line3Chars = Math.floor(
    interpolate(relativeFrame, [70, 90], [0, line3.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const floatY = float(relativeFrame, 160, 6);

  return (
    <div style={{opacity: overallOpacity}}>
      {/* Text block at left */}
      <div
        style={{
          position: 'absolute',
          left: 126,
          top: 262,
          width: 520,
        }}
      >
        <div style={{opacity: textProgress, transform: `translateY(${(1 - textProgress) * 12}px)`}}>
          <Label>Answer</Label>
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: serif,
            fontSize: 74,
            lineHeight: 0.96,
            fontWeight: 400,
            opacity: titleProgress,
            transform: `translateY(${(1 - titleProgress) * 12}px)`,
          }}
        >
          Ready to cite.
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: body,
            fontSize: 32,
            lineHeight: 1.36,
            color: colors.inkSoft,
            opacity: bodyProgress,
            transform: `translateY(${(1 - bodyProgress) * 12}px)`,
          }}
        >
          Moments, timestamps, entities, and source context come back clean enough for an agent to use.
        </div>
      </div>

      {/* Screenshot at right */}
      <div
        style={{
          position: 'absolute',
          left: 684,
          top: 120 + floatY,
          width: 1100,
          borderRadius: 28,
          overflow: 'hidden',
          background: '#050506',
          boxShadow: '0 34px 120px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Img
          src={staticFile('assets/agent-answer.png')}
          style={{display: 'block', width: '100%'}}
        />
      </div>

      {/* Sources card at bottom-right */}
      <div
        style={{
          position: 'absolute',
          right: 182,
          bottom: 142,
          width: 520,
          borderRadius: 28,
          padding: '28px 32px',
          background: 'rgba(21,23,31,0.9)',
          border: `1px solid ${colors.line}`,
          opacity: cardOpacity,
          fontFamily: mono,
          fontSize: 24,
          lineHeight: 1.65,
        }}
      >
        <div style={{color: colors.olive}}>
          {line1.slice(0, line1Chars)}
          {line1Chars < line1.length && (
            <span style={{opacity: frame % 30 < 15 ? 1 : 0}}>|</span>
          )}
        </div>
        <div style={{color: colors.inkSoft}}>
          {line2.slice(0, line2Chars)}
          {line2Chars < line2.length && (
            <span style={{opacity: frame % 30 < 15 ? 1 : 0}}>|</span>
          )}
        </div>
        <div style={{color: colors.amber}}>
          {line3.slice(0, line3Chars)}
          {line3Chars < line3.length && (
            <span style={{opacity: frame % 30 < 15 ? 1 : 0}}>|</span>
          )}
        </div>
      </div>
    </div>
  );
};
