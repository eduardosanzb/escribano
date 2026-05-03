import React from 'react';
import {useCurrentFrame, interpolate, Easing} from 'remotion';
import {ChatMessage} from './ChatMessage';
import {ThinkingBlock} from './ThinkingBlock';
import {AnswerBlock} from './AnswerBlock';
import {MiniCliCall} from './MiniCliCall';
import {DocumentDraft} from './DocumentDraft';
import {LogoLockup} from './LogoLockup';

export const AgentPanelMobile: React.FC = () => {
  const frame = useCurrentFrame();

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
  const scrollOffset = scrollProgress * 1200;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1080,
        height: 1920,
        opacity: panelOpacity,
      }}
    >
      <div
        style={{
          width: 940,
          marginLeft: 70,
          paddingTop: 120,
          paddingBottom: 120,
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
