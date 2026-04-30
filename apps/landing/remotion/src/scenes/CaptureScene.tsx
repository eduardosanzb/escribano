import React from 'react';
import {staticFile, Img, useCurrentFrame} from 'remotion';
import {enterExit, float, continuousZoom} from '../motion';

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

const Pulse: React.FC<{left: number; top: number; delay: number; frame: number}> = ({
  left,
  top,
  delay,
  frame,
}) => {
  const loop = ((frame - delay) % 90) / 90;
  const p = loop < 0 ? 0 : loop;
  return (
    <div style={{position: 'absolute', left, top}}>
      {/* Outer soft glow ring */}
      <div
        style={{
          position: 'absolute',
          left: -20,
          top: -20,
          width: 56,
          height: 56,
          borderRadius: 999,
          boxShadow: `0 0 0 ${p * 60}px rgba(74,158,122,${0.1 * (1 - p)})`,
        }}
      />
      {/* Core pulse */}
      <div
        style={{
          position: 'absolute',
          width: 16,
          height: 16,
          borderRadius: 999,
          background: colors.olive,
          boxShadow: `0 0 0 ${p * 42}px rgba(74,158,122,${0.22 * (1 - p)})`,
        }}
      />
    </div>
  );
};

const WordReveal: React.FC<{
  text: string;
  frame: number;
  baseDelay: number;
  wordsPerDelay?: number;
}> = ({text, frame, baseDelay, wordsPerDelay = 1}) => {
  const words = text.split(' ');
  return (
    <>
      {words.map((word, i) => {
        const delay = baseDelay + i * 6 * wordsPerDelay;
        return (
          <span
            key={i}
            style={{
              opacity: enterExit(frame, delay, delay + 20, 120, 150),
              display: 'inline-block',
              marginRight: '0.3em',
            }}
          >
            {word}
          </span>
        );
      })}
    </>
  );
};

const LineReveal: React.FC<{
  lines: string[];
  frame: number;
  baseDelay: number;
}> = ({lines, frame, baseDelay}) => {
  return (
    <>
      {lines.map((line, i) => {
        const delay = baseDelay + i * 8;
        return (
          <div
            key={i}
            style={{
              opacity: enterExit(frame, delay, delay + 20, 120, 150),
            }}
          >
            {line}
          </div>
        );
      })}
    </>
  );
};

export const CaptureScene: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;
  const opacity = enterExit(relativeFrame, 0, 25, 120, 150);

  // Dramatic screenshot entrance: frames 0-40
  const entranceProgress = Math.min(Math.max(relativeFrame / 40, 0), 1);
  const entranceEase = 1 - Math.pow(1 - entranceProgress, 3); // ease-out cubic
  const screenshotTranslateY = 80 * (1 - entranceEase);
  const screenshotScale = 0.92 + 0.08 * entranceEase;

  return (
    <div style={{opacity}}>
      {/* Text block at left */}
      <div
        style={{
          position: 'absolute',
          left: 126,
          top: 262,
          width: 520,
        }}
      >
        <div style={{opacity: enterExit(relativeFrame, 5, 30, 120, 150)}}>
          <Label>Capture</Label>
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: serif,
            fontSize: 74,
            lineHeight: 0.96,
            fontWeight: 400,
          }}
        >
          <WordReveal text="Capture, quietly" frame={relativeFrame} baseDelay={10} />
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: body,
            fontSize: 32,
            lineHeight: 1.36,
            color: colors.inkSoft,
          }}
        >
          <LineReveal
            lines={[
              'A small menu-bar app watches your screen in the background.',
              'Repeats are skipped, nothing is uploaded, and you can pause it whenever you want.',
            ]}
            frame={relativeFrame}
            baseDelay={22}
          />
        </div>
        <div
          style={{
            marginTop: 46,
            width: 290,
            height: 2,
            background: colors.amber,
            opacity: 0.7 * enterExit(relativeFrame, 38, 58, 120, 150),
          }}
        />
      </div>

      {/* Screenshot container at right */}
      <div
        style={{
          position: 'absolute',
          left: 710,
          top: 178 + float(relativeFrame, 150, 6),
          width: 1030,
          overflow: 'hidden',
          borderRadius: 28,
          background: '#050506',
          boxShadow: '0 34px 120px rgba(0,0,0,0.5)',
          transform: `translateY(${screenshotTranslateY}px) scale(${screenshotScale * continuousZoom(relativeFrame, 1, 1.045, 150)})`,
          transformOrigin: 'center center',
        }}
      >
        <Img
          src={staticFile('assets/health.png')}
          style={{
            display: 'block',
            width: '100%',
            borderRadius: 28,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        />
      </div>

      {/* Pulse indicator */}
      <Pulse left={1520} top={304} delay={0} frame={relativeFrame} />
    </div>
  );
};
