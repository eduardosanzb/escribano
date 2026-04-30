import React, {useEffect, useState} from 'react';
import {
	Html5Audio,
	useVideoConfig,
	delayRender,
	continueRender,
	cancelRender,
	interpolate,
} from 'remotion';
import {audioBufferToDataUrl} from '@remotion/media-utils';

export const AmbientMusic: React.FC = () => {
	const {durationInFrames, fps} = useVideoConfig();
	const [handle] = useState(() => delayRender('Generating ambient audio'));
	const [audioBuffer, setAudioBuffer] = useState<string | null>(null);

	useEffect(() => {
		const sampleRate = 44100;
		const length = Math.floor(sampleRate * (durationInFrames / fps));
		const offlineContext = new OfflineAudioContext(2, length, sampleRate);

		const frequencies = [130.81, 196.0, 261.63, 329.63];
		const modPeriods = [8, 11, 7, 13];
		const modMin = [0.05, 0.03, 0.02, 0.01];
		const modMax = [0.15, 0.12, 0.08, 0.06];

		const oscillators: OscillatorNode[] = [];
		const gainNodes: GainNode[] = [];

		for (let i = 0; i < frequencies.length; i++) {
			const osc = offlineContext.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = frequencies[i];
			const gain = offlineContext.createGain();
			osc.connect(gain);
			gain.connect(offlineContext.destination);
			oscillators.push(osc);
			gainNodes.push(gain);
		}

		const durationSeconds = durationInFrames / fps;
		const numCycles = 2;

		for (let i = 0; i < gainNodes.length; i++) {
			const gain = gainNodes[i];
			const period = modPeriods[i];
			const min = modMin[i];
			const max = modMax[i];
			const totalCycles = Math.ceil((durationSeconds / period) * numCycles);

			for (let c = 0; c <= totalCycles; c++) {
				const t = (c / totalCycles) * durationSeconds;
				const value = c % 2 === 0 ? max : min;
				gain.gain.setValueAtTime(value, t);
				if (c < totalCycles) {
					const nextT = ((c + 1) / totalCycles) * durationSeconds;
					const nextValue = c % 2 === 0 ? min : max;
					gain.gain.linearRampToValueAtTime(nextValue, nextT);
				}
			}
		}

		// Master low-pass filter at 800 Hz
		const masterFilter = offlineContext.createBiquadFilter();
		masterFilter.type = 'lowpass';
		masterFilter.frequency.value = 800;

		// Re-route: disconnect gains from destination, connect through filter
		for (let i = 0; i < gainNodes.length; i++) {
			gainNodes[i].disconnect(offlineContext.destination);
			gainNodes[i].connect(masterFilter);
		}
		masterFilter.connect(offlineContext.destination);

		for (const osc of oscillators) {
			osc.start(0);
		}

		offlineContext
			.startRendering()
			.then((buffer) => {
				const url = audioBufferToDataUrl(buffer);
				setAudioBuffer(url);
				continueRender(handle);
			})
			.catch((err) => {
				cancelRender(err);
			});
	}, [durationInFrames, fps, handle]);

	if (!audioBuffer) {
		return null;
	}

	return (
		<Html5Audio
			src={audioBuffer}
			volume={(f) =>
				interpolate(
					f,
					[0, 60, durationInFrames - 60, durationInFrames],
					[0, 0.25, 0.25, 0],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			}
		/>
	);
};
