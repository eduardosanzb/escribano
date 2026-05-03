import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {float, parallax} from '../motion';

export const AGENT_COLORS = {
  ink: '#E8E9EE',
  inkSoft: '#9395A5',
  inkMuted: '#5C5F72',
  bg: '#0A0A0F',
  surface: '#15171F',
  elevated: '#1C1F2B',
  line: '#2A2D3A',
  amber: '#E8A838',
  amberLight: '#F0BC5A',
  olive: '#4A9E7A',
  rust: '#B85C38',
  blue: '#314573',
  cream: '#F5F0E8',
};

export const AGENT_FONTS = {
  serif: "'Cormorant Garamond', Georgia, serif",
  body: "'Spectral', Georgia, serif",
  sans: "'DM Sans', system-ui, sans-serif",
  mono: "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace",
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
      background: `repeating-linear-gradient(90deg, ${AGENT_COLORS.rust} 0 18px, ${AGENT_COLORS.blue} 18px 36px, ${AGENT_COLORS.amber} 36px 54px, ${AGENT_COLORS.blue} 54px 72px)`,
    }}
  />
);

export const BrandWordmark: React.FC<{size?: number; centered?: boolean}> = ({
  size = 2,
  centered = false,
}) => {
  const fontSize = typeof size === 'number' ? `${size}rem` : size;
  return (
    <span
      style={{
        fontFamily: AGENT_FONTS.serif,
        fontSize,
        fontWeight: 500,
        letterSpacing: '0.02em',
        color: AGENT_COLORS.ink,
        display: 'inline-block',
        textAlign: centered ? 'center' : 'left',
      }}
    >
      Escrib
      <span style={{color: AGENT_COLORS.amber}}>a</span>
      no
    </span>
  );
};

export const AgentStage: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();

  const oliveX = 74 + parallax(frame, 200, 3);
  const oliveY = 12 + parallax(frame, 250, 2);
  const amberX = 8 + parallax(frame, 220, 2);
  const amberY = 92 + parallax(frame, 180, 3);

  const gridOpacity = 0.28 + float(frame, 180, 0.08);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${AGENT_COLORS.bg} 0%, ${AGENT_COLORS.surface} 100%)`,
        color: AGENT_COLORS.ink,
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

      {/* Grain overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\")",
          opacity: 0.15,
          pointerEvents: 'none',
        }}
      />

      <TileStrip />

      {children}
    </AbsoluteFill>
  );
};
