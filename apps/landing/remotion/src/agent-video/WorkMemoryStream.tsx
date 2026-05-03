import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';

// Local dark-mode constants (mirroring AgentStage.tsx palette)
const colors = {
  ink: '#E8E9EE',
  inkSoft: '#9395A5',
  inkMuted: '#5C5F72',
  bg: '#0A0A0F',
  surface: '#15171F',
  elevated: '#1C1F2B',
  line: '#2A2D3A',
  amber: '#E8A838',
  olive: '#4A9E7A',
  rust: '#B85C38',
  blue: '#314573',
};

const fonts = {
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "'DM Sans', system-ui, sans-serif",
  mono: "'SF Mono', SFMono-Regular, Menlo, monospace",
};

export type WorkMemoryMode = 'empty' | 'searching' | 'files' | 'signals' | 'receipts' | 'morning';

interface EvidenceItem {
  time: string;
  source: string;
  title: string;
  description: string;
}

const STAGGER_FRAMES = 18;

const fileEvidence: EvidenceItem[] = [
  {
    time: '14:32',
    source: 'VS Code',
    title: 'auth/session.ts',
    description: 'Edited refresh-token branch',
  },
  {
    time: '14:41',
    source: 'VS Code',
    title: 'middleware.ts',
    description: 'Traced 401 retry path',
  },
  {
    time: '14:48',
    source: 'VS Code',
    title: 'refresh-token.test.ts',
    description: 'Added failing regression case',
  },
];

const signalEvidence: EvidenceItem[] = [
  {
    time: '14:51',
    source: 'Terminal',
    title: 'pnpm test auth',
    description: 'Failing refresh-token test',
  },
  {
    time: '15:02',
    source: 'Browser',
    title: 'NextAuth callback docs',
    description: 'Opened provider callback reference',
  },
  {
    time: '15:08',
    source: 'Slack',
    title: '"still seeing 401 after refresh"',
    description: 'Team thread confirms repro',
  },
  {
    time: '15:16',
    source: 'Meeting',
    title: 'retry loop might be provider-side',
    description: 'Transcript note captured',
  },
];

const morningTodos = [
  'Verify auth retry loop',
  'Re-run failing test',
  'Update PR notes',
  'Follow up in Slack thread',
];

// ─── Evidence card with spring slide-in from left ───

const EvidenceCard: React.FC<{
  item: EvidenceItem;
  index: number;
  frame: number;
  fps: number;
  condensed?: boolean;
  pulse?: boolean;
  pulseColor?: string;
}> = ({item, index, frame, fps, condensed = false, pulse = false, pulseColor = colors.amber}) => {
  const delay = index * STAGGER_FRAMES;

  const entranceProgress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: {damping: 25, stiffness: 120, mass: 0.6},
  });

  const slideX = (1 - entranceProgress) * -50;
  const opacity = entranceProgress;

  const pulseIntensity = pulse
    ? interpolate(frame, [0, 30], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }) *
      (0.25 + 0.25 * Math.sin(frame / 12))
    : 0;

  const glowRgb = pulseColor === colors.amber ? '232,168,56' : '74,158,122';

  return (
    <div
      style={{
        opacity,
        transform: `translateX(${slideX}px)`,
        padding: condensed ? '8px 12px' : '10px 14px',
        background: colors.elevated,
        borderRadius: 8,
        border: pulse ? `1.5px solid ${pulseColor}` : `1px solid ${colors.line}`,
        boxShadow: pulse ? `0 0 14px rgba(${glowRgb},${pulseIntensity})` : 'none',
        fontFamily: fonts.sans,
        fontSize: condensed ? 12 : 13,
        lineHeight: 1.4,
        color: colors.inkSoft,
        willChange: 'transform, opacity',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2}}>
        <span style={{fontFamily: fonts.mono, fontSize: condensed ? 10 : 11, color: colors.inkMuted}}>
          {item.time}
        </span>
        <span style={{fontSize: condensed ? 10 : 11, color: colors.olive}}>{item.source}</span>
      </div>
      <div style={{fontWeight: 500, color: colors.ink, fontSize: condensed ? 12 : 13, marginBottom: 1}}>
        {item.title}
      </div>
      <div style={{fontSize: condensed ? 11 : 12, color: colors.inkMuted}}>{item.description}</div>
    </div>
  );
};

// ─── Morning priority card ───

const MorningPriorityCard: React.FC<{
  frame: number;
  fps: number;
}> = ({frame, fps}) => {
  const entranceProgress = spring({
    frame,
    fps,
    config: {damping: 25, stiffness: 100, mass: 0.8},
  });

  const slideX = (1 - entranceProgress) * -50;
  const opacity = entranceProgress;

  return (
    <div
      style={{
        opacity,
        transform: `translateX(${slideX}px)`,
        padding: '18px 20px',
        background: colors.elevated,
        borderRadius: 12,
        border: `1px solid ${colors.line}`,
        fontFamily: fonts.sans,
        willChange: 'transform, opacity',
      }}
    >
      <div
        style={{
          fontFamily: fonts.serif,
          fontSize: 32,
          fontWeight: 400,
          color: colors.ink,
          marginBottom: 14,
        }}
      >
        Pick back up
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {morningTodos.map((todo, i) => {
          const todoDelay = (i + 1) * STAGGER_FRAMES;
          const todoProgress = spring({
            frame: Math.max(0, frame - todoDelay),
            fps,
            config: {damping: 25, stiffness: 120, mass: 0.6},
          });

          return (
            <div
              key={i}
              style={{
                opacity: todoProgress,
                transform: `translateX(${(1 - todoProgress) * -30}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 15,
                color: colors.inkSoft,
                willChange: 'transform, opacity',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: colors.line,
                  color: colors.inkMuted,
                  fontSize: 11,
                  fontFamily: fonts.mono,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span>{todo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Main component ───

export const WorkMemoryStream: React.FC<{mode: WorkMemoryMode}> = ({mode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Heading entrance spring (files / signals)
  const headingProgress = spring({
    frame,
    fps,
    config: {damping: 25, stiffness: 100, mass: 0.8},
  });
  const headingOpacity = headingProgress;
  const headingSlide = (1 - headingProgress) * -20;

  // Empty mode gentle fade
  const emptyFade = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Searching pulse
  const searchPulse =
    interpolate(frame, [0, 20], [0.4, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) *
    (0.5 + 0.5 * Math.sin(frame / 10));

  const Label: React.FC<{muted?: boolean}> = ({muted = false}) => (
    <div
      style={{
        fontFamily: fonts.sans,
        fontSize: 12,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: muted ? colors.inkMuted : colors.inkSoft,
        marginBottom: 12,
      }}
    >
      Work memory
    </div>
  );

  const LargeHeading: React.FC<{children: React.ReactNode}> = ({children}) => (
    <div
      style={{
        fontFamily: fonts.serif,
        fontSize: 48,
        fontWeight: 400,
        lineHeight: 1.1,
        color: colors.ink,
        marginBottom: 24,
        opacity: headingOpacity,
        transform: `translateX(${headingSlide}px)`,
        willChange: 'transform, opacity',
      }}
    >
      {children}
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        top: 150,
        width: 560,
        maxHeight: 900,
        overflow: 'hidden',
      }}
    >
      {mode === 'empty' && (
        <div style={{opacity: emptyFade}}>
          <Label muted />
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              color: colors.inkMuted,
              opacity: 0.6,
            }}
          >
            Waiting for an agent tool call.
          </div>
        </div>
      )}

      {mode === 'searching' && (
        <div>
          <Label />
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              color: colors.inkSoft,
              opacity: searchPulse,
            }}
          >
            Searching local context…
          </div>
        </div>
      )}

      {mode === 'files' && (
        <div>
          <LargeHeading>Every file</LargeHeading>
          <div style={{display: 'flex', flexDirection: 'column-reverse', gap: 8}}>
            {fileEvidence.map((item, i) => (
              <EvidenceCard
                key={`file-${i}`}
                item={item}
                index={i}
                frame={frame}
                fps={fps}
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'signals' && (
        <div>
          <LargeHeading>and every signal</LargeHeading>
          <div style={{display: 'flex', flexDirection: 'column-reverse', gap: 8}}>
            {[...fileEvidence, ...signalEvidence].map((item, i) => (
              <EvidenceCard
                key={`signal-${i}`}
                item={item}
                index={i}
                frame={frame}
                fps={fps}
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'receipts' && (
        <div style={{display: 'flex', flexDirection: 'column-reverse', gap: 6}}>
          {[...fileEvidence, ...signalEvidence].map((item, i) => {
            const pulse = i % 2 === 0;
            const pulseColor = i % 4 === 0 ? colors.amber : colors.olive;
            return (
              <EvidenceCard
                key={`receipt-${i}`}
                item={item}
                index={i}
                frame={frame}
                fps={fps}
                condensed
                pulse={pulse}
                pulseColor={pulseColor}
              />
            );
          })}
        </div>
      )}

      {mode === 'morning' && (
        <div>
          <MorningPriorityCard frame={frame} fps={fps} />
        </div>
      )}
    </div>
  );
};
