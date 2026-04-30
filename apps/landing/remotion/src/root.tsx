import React from 'react';
import {Composition} from 'remotion';
import {EscribanoDemo} from './video';

export const Root: React.FC = () => {
  return (
    <Composition
      id="EscribanoDemo"
      component={EscribanoDemo}
      durationInFrames={1080}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
