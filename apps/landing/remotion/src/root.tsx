import React from 'react';
import {Composition} from 'remotion';
import {EscribanoDemo} from './video';
import {AGENT_MEMORY_DURATION, EscribanoAgentMemory} from './agent-video';
import {AGENT_MEMORY_DURATION_MOBILE, EscribanoAgentMemoryMobile} from './agent-video-mobile';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="EscribanoDemo"
        component={EscribanoDemo}
        durationInFrames={1080}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="EscribanoAgentMemory"
        component={EscribanoAgentMemory}
        durationInFrames={AGENT_MEMORY_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      <Composition
        id="EscribanoAgentMemoryMobile"
        component={EscribanoAgentMemoryMobile}
        durationInFrames={AGENT_MEMORY_DURATION_MOBILE}
        fps={60}
        width={1080}
        height={1920}
      />
    </>
  );
};
