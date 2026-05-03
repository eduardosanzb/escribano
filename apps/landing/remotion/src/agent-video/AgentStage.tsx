import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {float, parallax} from '../motion';

export const AGENT_COLORS = {
  ink: '#1a1612',
  inkSoft: '#3d3530',
  inkMuted: '#7a6e66',
  parchment: '#f5f0e8',
  cream: '#faf7f2',
  surface: '#ede5d4',
  surfaceElev: '#e8e0ce',
  line: '#d4c9b5',
  terracotta: '#b85c38',
  olive: '#5c6b3a',
  amber: '#c4963a',
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
      background: `repeating-linear-gradient(90deg, ${AGENT_COLORS.terracotta} 0 18px, ${AGENT_COLORS.olive} 18px 36px, ${AGENT_COLORS.amber} 36px 54px, ${AGENT_COLORS.olive} 54px 72px)`,
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
      <span style={{color: AGENT_COLORS.terracotta}}>a</span>
      no
    </span>
  );
};

export const AgentStage: React.FC<{
  children: React.ReactNode;
  thinkingIntensity?: number;
  connectionIntensity?: number;
}> = ({children, thinkingIntensity = 0, connectionIntensity = 0}) => {
  const frame = useCurrentFrame();

  const dotGridOpacity = thinkingIntensity * 0.12;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, #faf7f2 0%, #f5f0e8 100%)`,
        color: AGENT_COLORS.ink,
        overflow: 'hidden',
      }}
    >
      <style>{css}</style>

      {/* Dot grid overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(26,22,18,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          opacity: dotGridOpacity,
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
          opacity: 0.08,
          pointerEvents: 'none',
        }}
      />

      {/* Connecting lines layer */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: connectionIntensity,
          pointerEvents: 'none',
        }}
      >
        {/* Line coordinates will be wired later */}
      </svg>

      <TileStrip />

      {children}
    </AbsoluteFill>
  );
};
