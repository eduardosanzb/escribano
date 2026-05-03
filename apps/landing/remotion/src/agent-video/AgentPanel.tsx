import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {ChatMessage} from './ChatMessage';
import {ThinkingBlock} from './ThinkingBlock';
import {AnswerBlock} from './AnswerBlock';
import {AGENT_COLORS, AGENT_FONTS} from './AgentStage';

export const AgentPanel: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const promptText = 'summarize my research on vector databases from this afternoon';
  const promptStart = 20;
  const promptSpeed = 2;
  const promptEnd = promptStart + promptText.length * promptSpeed;

  const thinkingStart = 156;
  const answerStart = 460;

  const panelOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scrollOffset = frame > 600 ? (frame - 600) * 0.5 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        opacity: panelOpacity,
      }}
    >
      <div
        style={{
          width: 800,
          marginLeft: 560,
          paddingTop: 60,
          paddingBottom: 80,
          transform: `translateY(${-scrollOffset}px)`,
        }}
      >
        <ChatMessage
          text={promptText}
          frame={frame}
          startFrame={promptStart}
          isUser={true}
          speed={promptSpeed}
        />
        {frame >= thinkingStart && (
          <ThinkingBlock frame={frame} startFrame={thinkingStart} />
        )}
        {frame >= answerStart && (
          <AnswerBlock frame={frame} startFrame={answerStart} />
        )}
      </div>
    </div>
  );
};
