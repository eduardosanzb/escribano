import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { AmbientMusic } from './components/AmbientMusic';
import { AgentStage } from './agent-video/AgentStage';
import { AgentPanel } from './agent-video/AgentPanel';

const FPS = 60;
export const AGENT_MEMORY_DURATION = 1800;

export const EscribanoAgentMemory: React.FC = () => {
  const frame = useCurrentFrame();
  const thinkingIntensity = interpolate(
    frame,
    [156, 200, 420, 460],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AgentStage thinkingIntensity={thinkingIntensity}>
      <AmbientMusic />
      <AgentPanel />
    </AgentStage>
  );
};
