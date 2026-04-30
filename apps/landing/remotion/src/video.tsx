import React from 'react';
import {Stage} from './components/Stage';
import {AmbientMusic} from './components/AmbientMusic';
import {IntroScene} from './scenes/IntroScene';
import {CaptureScene} from './scenes/CaptureScene';
import {ConnectScene} from './scenes/ConnectScene';
import {AskScene} from './scenes/AskScene';
import {AnswerScene} from './scenes/AnswerScene';
import {OutroScene} from './scenes/OutroScene';

export const EscribanoDemo: React.FC = () => {
  return (
    <Stage>
      <AmbientMusic />
      <IntroScene startFrame={0} />
      <CaptureScene startFrame={80} />
      <ConnectScene startFrame={200} />
      <AskScene startFrame={320} />
      <AnswerScene startFrame={440} />
      <OutroScene startFrame={560} />
    </Stage>
  );
};
