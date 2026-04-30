import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Terminal} from '../Terminal';
import {SCENES} from '../scenes';
import {enterExit, float, soft} from '../motion';

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

const Label: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      fontFamily: sans,
      fontSize: 21,
      letterSpacing: 4,
      textTransform: 'uppercase',
      color: colors.inkMuted,
    }}
  >
    {children}
  </div>
);

interface WordRevealProps {
  text: string;
  frame: number;
  startFrame: number;
  delayPerWord: number;
}

const WordReveal: React.FC<WordRevealProps> = ({text, frame, startFrame, delayPerWord}) => {
  const words = text.split(' ');
  return (
    <>
      {words.map((word, i) => {
        const p = soft((frame - startFrame - i * delayPerWord) / 15);
        return (
          <span key={i} style={{opacity: p}}>
            {word}{i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </>
  );
};

const Brand: React.FC<{progress: number; relativeFrame: number}> = ({progress, relativeFrame}) => {
  const exitProgress = enterExit(relativeFrame, 90, 120, 90, 120);
  const scale = 0.95 + 0.05 * exitProgress;
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 18}px) scale(${scale})`,
      }}
    >
      <div
        style={{
          fontFamily: serif,
          fontSize: 132,
          lineHeight: 0.9,
          fontWeight: 500,
          textShadow: '0 0 40px rgba(232,168,56,0.15)',
        }}
      >
        Escrib<span style={{color: colors.amber}}>ano</span>
      </div>
      <div
        style={{
          marginTop: 28,
          fontFamily: body,
          fontSize: 40,
          color: colors.inkSoft,
          letterSpacing: 0,
        }}
      >
        <WordReveal
          text="Your work, queryable by any agent."
          frame={relativeFrame}
          startFrame={40}
          delayPerWord={8}
        />
      </div>
    </div>
  );
};

export const IntroScene: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  const terminalProgress = enterExit(relativeFrame, 0, 30, 90, 120);
  const brandProgress = enterExit(relativeFrame, 10, 40, 90, 120);

  const exitProgress = enterExit(relativeFrame, 90, 120, 90, 120);
  const terminalScale = 0.95 + 0.05 * exitProgress;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 1100,
          top: 220,
          width: 580,
          opacity: terminalProgress,
          transform: `translateY(${float(relativeFrame, 90, 12)}px) translateX(${(1 - terminalProgress) * -30}px) scale(${terminalScale})`,
        }}
      >
        <Terminal width={580} startFrame={startFrame} scene={SCENES['hero-query']} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 126,
          top: 316,
          opacity: brandProgress,
          transform: `translateX(${(1 - brandProgress) * -30}px)`,
        }}
      >
        <Label>Local evidence layer</Label>
        <Brand progress={brandProgress} relativeFrame={relativeFrame} />
      </div>
    </>
  );
};
