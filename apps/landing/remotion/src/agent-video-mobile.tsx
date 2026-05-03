import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { AmbientMusic } from './components/AmbientMusic';
import { AgentStage } from './agent-video/AgentStage';
import { AgentPanelMobile } from './agent-video/AgentPanelMobile';

const FPS = 60;
export const AGENT_MEMORY_DURATION_MOBILE = 2100;

export const EscribanoAgentMemoryMobile: React.FC = () => {
  const frame = useCurrentFrame();
  const thinkingIntensity = interpolate(
    frame,
    [160, 200, 680, 720],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AgentStage thinkingIntensity={thinkingIntensity}>
      <AmbientMusic />
      <AgentPanelMobile />
    </AgentStage>
  );
};
