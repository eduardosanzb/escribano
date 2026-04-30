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
		const durationSeconds = durationInFrames / fps;

		const chords = [
			{start: 0, end: Math.min(8, durationSeconds), freqs: [130.81, 196.0, 261.63]},
			{start: 8, end: Math.min(16, durationSeconds), freqs: [110.0, 164.81, 220.0]},
			{start: 16, end: durationSeconds, freqs: [87.31, 130.81, 174.61]},
		];

		const masterGain = offlineContext.createGain();
		const sidechainGain = offlineContext.createGain();
		const masterFilter = offlineContext.createBiquadFilter();
		masterFilter.type = 'lowpass';
		masterFilter.frequency.value = 600;

		// Volume envelope: fade in 0→0.2 over 3s, hold, fade out 0.2→0 over 3s
		const fadeInEnd = Math.min(3, durationSeconds);
		const fadeOutStart = Math.max(fadeInEnd, durationSeconds - 3);

		masterGain.gain.setValueAtTime(0, 0);
		masterGain.gain.linearRampToValueAtTime(0.2, fadeInEnd);
		if (fadeOutStart > fadeInEnd) {
			masterGain.gain.setValueAtTime(0.2, fadeOutStart);
		}
		masterGain.gain.linearRampToValueAtTime(0, durationSeconds);

		// Sidechain ducking: every 2s, dip 10% for 100ms
		sidechainGain.gain.setValueAtTime(1.0, 0);
		for (let t = 0; t < durationSeconds; t += 2) {
			sidechainGain.gain.setValueAtTime(0.9, t);
			sidechainGain.gain.setValueAtTime(1.0, t + 0.1);
		}

		for (const chord of chords) {
			if (chord.start >= durationSeconds) continue;
			for (const freq of chord.freqs) {
				const osc = offlineContext.createOscillator();
				osc.type = 'triangle';
				osc.frequency.value = freq;
				const gain = offlineContext.createGain();
				gain.gain.value = 0.05;
				osc.connect(gain);
				gain.connect(masterGain);
				osc.start(chord.start);
				osc.stop(chord.end);
			}

			// Shimmer: one octave above the root
			const shimmerOsc = offlineContext.createOscillator();
			shimmerOsc.type = 'triangle';
			shimmerOsc.frequency.value = chord.freqs[0] * 2;
			const shimmerGain = offlineContext.createGain();
			shimmerGain.gain.value = 0.02;
			shimmerOsc.connect(shimmerGain);
			shimmerGain.connect(masterGain);
			shimmerOsc.start(chord.start);
			shimmerOsc.stop(chord.end);
		}

		// Noise texture: white noise through bandpass filter
		const noiseBuffer = offlineContext.createBuffer(1, sampleRate * 2, sampleRate);
		const noiseData = noiseBuffer.getChannelData(0);
		for (let i = 0; i < noiseData.length; i++) {
			noiseData[i] = Math.random() * 2 - 1;
		}
		const noiseSource = offlineContext.createBufferSource();
		noiseSource.buffer = noiseBuffer;
		noiseSource.loop = true;
		const noiseGain = offlineContext.createGain();
		noiseGain.gain.value = 0.005;
		const noiseFilter = offlineContext.createBiquadFilter();
		noiseFilter.type = 'bandpass';
		noiseFilter.frequency.value = 750;
		noiseFilter.Q.value = 0.7;

		noiseSource.connect(noiseGain);
		noiseGain.connect(noiseFilter);
		noiseFilter.connect(masterGain);
		noiseSource.start(0);

		// Chain: masterGain → sidechainGain → masterFilter → destination
		masterGain.connect(sidechainGain);
		sidechainGain.connect(masterFilter);
		masterFilter.connect(offlineContext.destination);

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
