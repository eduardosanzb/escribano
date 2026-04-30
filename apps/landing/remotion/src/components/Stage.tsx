import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {float, parallax} from '../motion';

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

const css = String.raw`
@font-face {
  font-family: 'Cormorant Garamond';
  src: url('/public/fonts/cormorant-garamond-regular.woff2') format('woff2');
  font-weight: 300 600;
}
@font-face {
  font-family: 'Spectral';
  src: url('/public/fonts/spectral-light.woff2') format('woff2');
  font-weight: 300;
}
@font-face {
  font-family: 'DM Sans';
  src: url('/public/fonts/dm-sans.woff2') format('woff2');
  font-weight: 300 500;
}
`;

const TileStrip: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 6,
      background: `repeating-linear-gradient(90deg, ${colors.rust} 0 18px, ${colors.blue} 18px 36px, ${colors.amber} 36px 54px, ${colors.blue} 54px 72px)`,
    }}
  />
);

interface ParticleProps {
  frame: number;
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
  color: string;
}

const Particle: React.FC<ParticleProps> = ({
  frame,
  x,
  y,
  size,
  speedX,
  speedY,
  opacity,
  color,
}) => {
  const left = (x + frame * speedX) % 1920;
  const top = (y + frame * speedY) % 1080;
  const currentSize = size * (0.8 + 0.2 * Math.sin(frame / 60));

  return (
    <div
      style={{
        position: 'absolute',
        left: left < 0 ? left + 1920 : left,
        top: top < 0 ? top + 1080 : top,
        width: currentSize,
        height: currentSize,
        borderRadius: 999,
        background: color,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

interface FloatingDotProps {
  frame: number;
  left: number;
  top: number;
  color: string;
  speed: number;
  amplitude: number;
}

const FloatingDot: React.FC<FloatingDotProps> = ({
  frame,
  left,
  top,
  color,
  speed,
  amplitude,
}) => {
  const driftY = float(frame + left, speed, amplitude);
  const driftX = float(frame + top, speed * 1.3, amplitude * 0.7);

  return (
    <div
      style={{
        position: 'absolute',
        left: left + driftX,
        top: top + driftY,
        width: 2,
        height: 2,
        borderRadius: 999,
        background: color,
      }}
    />
  );
};

const PARTICLES: Omit<ParticleProps, 'frame'>[] = [
  {x: 120, y: 80, size: 2, speedX: 0.2, speedY: 0.15, opacity: 0.25, color: colors.amber},
  {x: 480, y: 220, size: 1.5, speedX: -0.1, speedY: 0.3, opacity: 0.2, color: colors.olive},
  {x: 860, y: 140, size: 3, speedX: 0.35, speedY: -0.2, opacity: 0.3, color: colors.rust},
  {x: 1300, y: 360, size: 1, speedX: -0.25, speedY: 0.1, opacity: 0.15, color: colors.blue},
  {x: 1700, y: 180, size: 2.5, speedX: 0.15, speedY: 0.4, opacity: 0.22, color: colors.amber},
  {x: 340, y: 520, size: 1.5, speedX: -0.3, speedY: -0.15, opacity: 0.18, color: colors.olive},
  {x: 720, y: 640, size: 2, speedX: 0.4, speedY: 0.25, opacity: 0.28, color: colors.rust},
  {x: 1080, y: 480, size: 1, speedX: -0.2, speedY: -0.35, opacity: 0.15, color: colors.blue},
  {x: 1560, y: 560, size: 2.5, speedX: 0.25, speedY: 0.1, opacity: 0.2, color: colors.amber},
  {x: 200, y: 820, size: 1.5, speedX: -0.15, speedY: 0.2, opacity: 0.25, color: colors.olive},
  {x: 620, y: 900, size: 3, speedX: 0.3, speedY: -0.25, opacity: 0.35, color: colors.rust},
  {x: 980, y: 780, size: 1, speedX: -0.4, speedY: 0.15, opacity: 0.15, color: colors.blue},
  {x: 1420, y: 860, size: 2, speedX: 0.1, speedY: -0.3, opacity: 0.2, color: colors.amber},
  {x: 1840, y: 740, size: 1.5, speedX: -0.35, speedY: 0.4, opacity: 0.18, color: colors.olive},
  {x: 260, y: 340, size: 2.5, speedX: 0.45, speedY: -0.1, opacity: 0.3, color: colors.rust},
  {x: 540, y: 160, size: 1, speedX: -0.2, speedY: 0.35, opacity: 0.15, color: colors.blue},
  {x: 1180, y: 240, size: 2, speedX: 0.15, speedY: -0.2, opacity: 0.22, color: colors.amber},
  {x: 1620, y: 420, size: 1.5, speedX: -0.3, speedY: 0.25, opacity: 0.2, color: colors.olive},
];

export const Stage: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();

  const oliveX = 74 + parallax(frame, 200, 3);
  const oliveY = 12 + parallax(frame, 250, 2);
  const amberX = 8 + parallax(frame, 220, 2);
  const amberY = 92 + parallax(frame, 180, 3);

  const gridOpacity = 0.28 + float(frame, 180, 0.08);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${colors.bg}, ${colors.surface})`,
        color: colors.ink,
        overflow: 'hidden',
      }}
    >
      <style>{css}</style>

      {/* Radial gradient overlays */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at ${oliveX}% ${oliveY}%, rgba(74,158,122,0.2), transparent 34%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at ${amberX}% ${amberY}%, rgba(232,168,56,0.18), transparent 28%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Particles */}
      {PARTICLES.map((p, i) => (
        <Particle key={i} frame={frame} {...p} />
      ))}

      {/* Grid overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          opacity: gridOpacity,
          pointerEvents: 'none',
        }}
      />

      <TileStrip />

      <FloatingDot frame={frame} left={280} top={180} color={colors.amber} speed={140} amplitude={14} />
      <FloatingDot frame={frame} left={1120} top={340} color={colors.olive} speed={170} amplitude={10} />
      <FloatingDot frame={frame} left={860} top={620} color={colors.rust} speed={130} amplitude={16} />
      <FloatingDot frame={frame} left={160} top={740} color={colors.amber} speed={150} amplitude={12} />

      {children}
    </AbsoluteFill>
  );
};
