import React from 'react';
import {interpolate} from 'remotion';

interface LogoLockupProps {
  frame: number;
  startFrame: number;
  isMobile?: boolean;
}

export const LogoLockup: React.FC<LogoLockupProps> = ({
  frame,
  startFrame,
  isMobile = false,
}) => {
  const progress = interpolate(
    frame,
    [startFrame, startFrame + 30],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const taglineProgress = interpolate(
    frame,
    [startFrame + 20, startFrame + 50],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 20}px)`,
      }}
    >
      <div
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: isMobile ? 85 : 62,
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: '#1a1612',
        }}
      >
        Escrib
        <span style={{color: '#b85c38'}}>a</span>
        no
      </div>
      <div
        style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: isMobile ? 30 : 20,
          letterSpacing: '0.04em',
          color: '#7a6e66',
          opacity: taglineProgress,
        }}
      >
        Memory for AI agents.
      </div>
    </div>
  );
};
