import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
import {ChatMessage} from './ChatMessage';
import {ThinkingBlock} from './ThinkingBlock';
import {AnswerBlock} from './AnswerBlock';
import {MiniCliCall} from './MiniCliCall';
import {DocumentDraft} from './DocumentDraft';
import {LogoLockup} from './LogoLockup';

export const AgentPanelMobile: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();

  const promptText = 'summarize my research on vector databases from this afternoon';
  const promptStart = 40;
  const promptSpeed = 2;

  const thinkingStart = 160;
  const answerStart = 720;
  const docPromptStart = 920;
  const miniCliStart = 1040;
  const documentStart = 1160;
  const logoStart = 1500;

  const panelOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out chat content before logo
  const chatFadeOut = interpolate(
    frame,
    [1360, 1500],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Smooth scroll with ease-in-out curve
  const scrollProgress = interpolate(
    frame,
    [400, 1400],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.ease),
    }
  );
  const scrollOffset = scrollProgress * Math.round(height * 0.625);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        opacity: panelOpacity,
      }}
    >
      <div
        style={{
          width: Math.round(width * 0.87),
          marginLeft: Math.round(width * 0.065),
          paddingTop: Math.round(height * 0.063),
          paddingBottom: Math.round(height * 0.063),
          transform: `translateY(${-scrollOffset}px)`,
          opacity: chatFadeOut,
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
        {frame >= docPromptStart && (
          <div style={{marginTop: 64}}>
            <ChatMessage
              text="create research doc"
              frame={frame}
              startFrame={docPromptStart}
              isUser={true}
              speed={promptSpeed}
            />
          </div>
        )}
        {frame >= miniCliStart && (
          <MiniCliCall frame={frame} startFrame={miniCliStart} />
        )}
        {frame >= documentStart && (
          <DocumentDraft frame={frame} startFrame={documentStart} />
        )}
      </div>
      {frame >= logoStart && (
        <LogoLockup frame={frame} startFrame={logoStart} isMobile />
      )}
    </div>
  );
};
