import React, {useMemo} from 'react';
import {useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {enterExit, float} from '../motion';

const colors = {
  ink: '#E8E9EE',
  inkMuted: '#5C5F72',
  amber: '#E8A838',
};

const serif = "'Cormorant Garamond', Georgia, serif";
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

// Deterministic pseudo-random for particles (seeded by index)
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 9301;
  return x - Math.floor(x);
}

interface Particle {
  angle: number;
  speed: number;
  size: number;
}

function createParticles(count: number): Particle[] {
  return Array.from({length: count}, (_, i) => ({
    angle: seededRandom(i * 2) * Math.PI * 2,
    speed: 80 + seededRandom(i * 2 + 1) * 120,
    size: 3 + seededRandom(i * 7) * 3,
  }));
}

export const OutroScene: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const relativeFrame = frame - startFrame;

  const visibility = enterExit(relativeFrame, 0, 30, 120, 150);

  // Dramatic entrance: scale from 0.8 to 1.0 with overshoot to 1.03 then settle to 1.0 over frames 0-50
  const entranceProgress = interpolate(relativeFrame, [0, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scaleSpring = spring({
    frame: relativeFrame,
    fps,
    config: {
      damping: 12,
      stiffness: 80,
      mass: 1,
      overshootClamping: false,
    },
    from: 0,
    to: 1,
    durationInFrames: 50,
  });
  const overshootScale = interpolate(scaleSpring, [0, 1], [0.8, 1.03]);
  const settleScale = interpolate(
    relativeFrame,
    [35, 50],
    [1.03, 1.0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );
  const textScale = relativeFrame < 35 ? overshootScale : settleScale;
  const textOpacity = interpolate(relativeFrame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Underline draws from center outward: container overflow hidden, inner width 0 to 200px, centered
  const underlineWidth = interpolate(relativeFrame, [40, 80], [0, 200], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const underlineOpacity = enterExit(relativeFrame, 40, 80, 120, 150);

  // Particle burst: 8 dots radiate outward from center at frame 30
  const particles = useMemo(() => createParticles(8), []);
  const particleProgress = interpolate(relativeFrame, [30, 90], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const particleFade = interpolate(relativeFrame, [30, 90], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Background glow: radial gradient 400px, pulse opacity 0.05 to 0.15
  const glowOpacity = interpolate(
    relativeFrame,
    [0, 75],
    [0.05, 0.15],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );

  // CTA bounce on frame 80+
  const ctaBounce = relativeFrame >= 80 ? float(relativeFrame - 80, 30, 6) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        opacity: visibility,
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(232, 168, 56, ${glowOpacity}) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Particle burst */}
      <div
        style={{
          position: 'absolute',
          pointerEvents: 'none',
        }}
      >
        {particles.map((p, i) => {
          const distance = p.speed * particleProgress;
          const x = Math.cos(p.angle) * distance;
          const y = Math.sin(p.angle) * distance;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: p.size,
                height: p.size,
                borderRadius: '50%',
                background: colors.amber,
                transform: `translate(${x}px, ${y}px)`,
                opacity: particleFade,
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: `scale(${textScale})`,
          opacity: textOpacity,
        }}
      >
        <Label>escribano.work</Label>
        <div
          style={{
            marginTop: 32,
            fontFamily: serif,
            fontSize: 92,
            lineHeight: 1,
            textAlign: 'center',
          }}
        >
          Ask your work what happened.
        </div>

        {/* Underline draws from center outward */}
        <div
          style={{
            marginTop: 32,
            width: 200,
            height: 2,
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            opacity: underlineOpacity,
          }}
        >
          <div
            style={{
              width: underlineWidth,
              height: '100%',
              background: colors.amber,
            }}
          />
        </div>
      </div>

      {/* CTA with bounce */}
      <div
        style={{
          marginTop: 48,
          fontFamily: sans,
          fontSize: 18,
          letterSpacing: 2,
          color: colors.inkMuted,
          transform: `translateY(${ctaBounce}px)`,
          opacity: interpolate(relativeFrame, [60, 80], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        escribano.work
      </div>
    </div>
  );
};
