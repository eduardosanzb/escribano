import React from 'react';
import {useCurrentFrame} from 'remotion';
import {
  TerminalScene,
  TYPE_SPEED_FRAMES,
  LINE_PAUSE_FRAMES,
  LOOP_PAUSE_FRAMES,
  SIGILS,
  LINE_COLORS,
  SIGIL_COLORS,
} from './scenes';

const mono = "'SF Mono', SFMono-Regular, Menlo, monospace";

interface TerminalProps {
  scene: TerminalScene;
  width?: number;
  startFrame?: number;
}

export const Terminal: React.FC<TerminalProps> = ({
  scene,
  width = 620,
  startFrame = 0,
}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  // Calculate total scene duration
  const typedTypes = new Set<string>(['user', 'cmd']);
  
  const getLineDuration = (line: {type: string; text: string}) => {
    if (typedTypes.has(line.type)) {
      return line.text.length * TYPE_SPEED_FRAMES + LINE_PAUSE_FRAMES;
    }
    return LINE_PAUSE_FRAMES;
  };

  const sceneDuration = scene.lines.reduce((acc, line) => acc + getLineDuration(line), 0) + LOOP_PAUSE_FRAMES;

  // Determine which cycle we're in (for looping)
  const cycleFrame = scene.loop
    ? relativeFrame % sceneDuration
    : Math.min(relativeFrame, sceneDuration);

  // Calculate which lines are visible and how much of each is typed
  let currentTime = 0;
  const visibleLines: Array<{
    type: string;
    text: string;
    sigil: string;
    visibleChars: number;
    showCaret: boolean;
    isComplete: boolean;
  }> = [];

  for (const line of scene.lines) {
    const lineDuration = getLineDuration(line);
    
    if (cycleFrame < currentTime) {
      break;
    }

    const lineStart = currentTime;
    const lineEnd = currentTime + lineDuration;

    if (cycleFrame >= lineEnd) {
      // Line is fully visible
      visibleLines.push({
        type: line.type,
        text: line.text,
        sigil: SIGILS[line.type as keyof typeof SIGILS] || '',
        visibleChars: line.text.length,
        showCaret: false,
        isComplete: true,
      });
    } else {
      // Line is partially visible
      const elapsedInLine = cycleFrame - lineStart;
      
      if (typedTypes.has(line.type)) {
        const typeDuration = line.text.length * TYPE_SPEED_FRAMES;
        const visibleChars = Math.min(Math.floor(elapsedInLine / TYPE_SPEED_FRAMES), line.text.length);
        const isTyping = elapsedInLine < typeDuration;
        
        visibleLines.push({
          type: line.type,
          text: line.text,
          sigil: SIGILS[line.type as keyof typeof SIGILS] || '',
          visibleChars,
          showCaret: isTyping,
          isComplete: false,
        });
      } else {
        // Non-typed lines appear instantly
        visibleLines.push({
          type: line.type,
          text: line.text,
          sigil: SIGILS[line.type as keyof typeof SIGILS] || '',
          visibleChars: line.text.length,
          showCaret: false,
          isComplete: false,
        });
      }
      
      // Stop processing more lines since we're in the middle of this one
      break;
    }

    currentTime += lineDuration;
  }

  const dotColors = ['#ff5f56', '#ffbd2e', '#27ca40'];

  return (
    <div
      style={{
        width,
        background: '#0e0f14',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 12px 48px rgba(26,22,18,0.15)',
        fontFamily: mono,
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      {/* Terminal Header */}
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {dotColors.map((color, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: color,
            }}
          />
        ))}
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 11,
            color: 'rgba(255,255,255,0.35)',
            marginLeft: 6,
            letterSpacing: '0.04em',
          }}
        >
          {scene.title}
        </span>
      </div>

      {/* Terminal Body */}
      <div
        style={{
          padding: '16px 18px 20px',
          color: 'rgba(245,240,232,0.82)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minHeight: 200,
        }}
      >
        {visibleLines.map((line, index) => {
          const lineColor = LINE_COLORS[line.type as keyof typeof LINE_COLORS] || 'rgba(245,240,232,0.82)';
          const sigilColor = SIGIL_COLORS[line.type as keyof typeof SIGIL_COLORS] || '';
          
          return (
            <div
              key={`${line.type}-${index}`}
              style={{
                color: lineColor,
                minHeight: '1em',
                marginBottom: 2,
              }}
            >
              {line.sigil && (
                <span
                  style={{
                    color: sigilColor,
                    fontWeight: 600,
                    marginRight: 4,
                    display: 'inline-block',
                    width: '1.1em',
                  }}
                >
                  {line.sigil}
                </span>
              )}
              {line.text.slice(0, line.visibleChars)}
              {line.showCaret && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: '0.95em',
                    background: lineColor,
                    marginLeft: 2,
                    verticalAlign: '-2px',
                    opacity: 0.85,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
