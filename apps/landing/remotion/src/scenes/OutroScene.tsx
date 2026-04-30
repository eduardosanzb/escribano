import React from 'react';
import {useCurrentFrame, interpolate} from 'remotion';
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

export const OutroScene: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  const visibility = enterExit(relativeFrame, 0, 30, 120, 150);
  const underlineWidth = interpolate(relativeFrame, [40, 80], [0, 200], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const underlineOpacity = enterExit(relativeFrame, 40, 80, 120, 150);

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
        transform: `translateY(${float(relativeFrame, 100, 4)}px)`,
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
      <div
        style={{
          marginTop: 32,
          width: underlineWidth,
          height: 2,
          background: colors.amber,
          opacity: underlineOpacity,
        }}
      />
    </div>
  );
};
