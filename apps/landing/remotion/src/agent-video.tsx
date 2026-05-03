import React from 'react';
import {Sequence, interpolate, useCurrentFrame} from 'remotion';
import {AmbientMusic} from './components/AmbientMusic';
import {AgentStage, BrandWordmark} from './agent-video/AgentStage';
import {AgentPanel} from './agent-video/AgentPanel';
import {WorkMemoryStream} from './agent-video/WorkMemoryStream';

const FPS = 60;
export const AGENT_MEMORY_DURATION = 1800;
const SCENES = {
  gap: {from: 0, duration: 240},
  tool: {from: 240, duration: 240},
  files: {from: 480, duration: 300},
  signals: {from: 780, duration: 300},
  answer: {from: 1080, duration: 300},
  handoff: {from: 1380, duration: 240},
  morning: {from: 1620, duration: 180},
} as const;

export const EscribanoAgentMemory: React.FC = () => {
  return (
    <AgentStage>
      <AmbientMusic />

      <Sequence from={SCENES.gap.from} durationInFrames={SCENES.gap.duration}>
        <AgentPanel mode="gap" />
        <WorkMemoryStream mode="empty" />
      </Sequence>

      <Sequence from={SCENES.tool.from} durationInFrames={SCENES.tool.duration}>
        <AgentPanel mode="tool" />
        <WorkMemoryStream mode="searching" />
      </Sequence>

      <Sequence from={SCENES.files.from} durationInFrames={SCENES.files.duration}>
        <AgentPanel mode="tool" />
        <WorkMemoryStream mode="files" />
      </Sequence>

      <Sequence from={SCENES.signals.from} durationInFrames={SCENES.signals.duration}>
        <AgentPanel mode="tool" />
        <WorkMemoryStream mode="signals" />
      </Sequence>

      <Sequence from={SCENES.answer.from} durationInFrames={SCENES.answer.duration}>
        <AgentPanel mode="answer" />
        <WorkMemoryStream mode="receipts" />
      </Sequence>

      <Sequence from={SCENES.handoff.from} durationInFrames={SCENES.handoff.duration}>
        <AgentPanel mode="handoff" />
        <WorkMemoryStream mode="receipts" />
      </Sequence>

      <Sequence from={SCENES.morning.from} durationInFrames={SCENES.morning.duration}>
        <AgentPanel mode="morning" />
        <WorkMemoryStream mode="morning" />
        <MorningLockup />
      </Sequence>
    </AgentStage>
  );
};

const MorningLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeInStart = 90;
  const fadeInDuration = 30;

  const opacity = interpolate(
    frame,
    [fadeInStart, fadeInStart + fadeInDuration],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        opacity,
      }}
    >
      <BrandWordmark size={1.5} centered />
      <span
        style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: 14,
          letterSpacing: '0.04em',
          color: '#9395A5',
        }}
      >
        Memory for AI agents.
      </span>
    </div>
  );
};
