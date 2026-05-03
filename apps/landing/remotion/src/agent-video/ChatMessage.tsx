import React from 'react';
import {AGENT_FONTS} from './AgentStage';

export function typeText(text: string, frame: number, startFrame: number, speed = 2): string {
  return text.slice(0, Math.max(0, Math.floor((frame - startFrame) / speed)));
}

export const BlinkingCursor: React.FC<{frame: number; color?: string}> = ({frame, color}) => {
  return (
    <span
      style={{
        display: 'inline-block',
        verticalAlign: 'text-bottom',
        width: 2,
        height: '1.2em',
        background: color,
        opacity: frame % 32 < 16 ? 1 : 0,
      }}
    />
  );
};

interface ChatMessageProps {
  text: string;
  frame: number;
  startFrame: number;
  isUser?: boolean;
  speed?: number;
  showCursor?: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  text,
  frame,
  startFrame,
  isUser = false,
  speed = 2,
  showCursor = true,
}) => {
  const typed = typeText(text, frame, startFrame, speed);
  const displayText = isUser ? `> ${typed}` : typed;
  const isTyping = typed.length < text.length;

  return (
    <span
      style={{
        fontFamily: AGENT_FONTS.mono,
        color: isUser ? '#1a1612' : '#3d3530',
        fontSize: 15,
        lineHeight: 1.7,
      }}
    >
      {displayText}
      {showCursor && isTyping && (
        <BlinkingCursor frame={frame} color={isUser ? '#1a1612' : '#3d3530'} />
      )}
    </span>
  );
};
