import React, {useEffect, useState} from 'react';
import {
	Html5Audio,
	useVideoConfig,
	delayRender,
	continueRender,
	cancelRender,
	interpolate,
  useCurrentFrame,
} from 'remotion';
import {audioBufferToDataUrl} from '@remotion/media-utils';

export const AmbientMusic: React.FC = () => {
  const frame = useCurrentFrame();
	const {durationInFrames, fps} = useVideoConfig();
	const [handle] = useState(() => delayRender('Generating bossa nova audio'));
	const [audioBuffer, setAudioBuffer] = useState<string | null>(null);

	useEffect(() => {
		const sampleRate = 48000;
		const length = Math.floor(sampleRate * (durationInFrames / fps));
		const ctx = new OfflineAudioContext(2, length, sampleRate);
		const duration = durationInFrames / fps;

		const masterGain = ctx.createGain();
		masterGain.connect(ctx.destination);

		const bpm = 90;
		const beatInterval = 60 / bpm;
		const measureDuration = 4 * beatInterval;

		// === UPRIGHT BASS ===
		const bassRoots = [
			{time: 0, freq: 196.0, duration: 1.5},
			{time: measureDuration, freq: 246.94, duration: 1.5},
			{time: 2 * measureDuration, freq: 174.61, duration: 1.5},
		];

		for (let loopStart = 0; loopStart < duration; loopStart += 3 * measureDuration) {
			for (const note of bassRoots) {
				const t = loopStart + note.time;
				if (t >= duration) break;

				const osc = ctx.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = note.freq;

				const gain = ctx.createGain();
				const end = Math.min(t + note.duration, duration);
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.04, t + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.0001, end);

				osc.connect(gain);
				gain.connect(masterGain);
				osc.start(t);
				osc.stop(end);
			}
		}

		// === CONGA ===
		const congaPattern = [
			beatInterval,
			1.5 * beatInterval,
			3 * beatInterval,
			3.5 * beatInterval,
		];

		for (let measureStart = 0; measureStart < duration; measureStart += measureDuration) {
			for (const offset of congaPattern) {
				const t = measureStart + offset;
				if (t >= duration) break;

				const noise = ctx.createBufferSource();
				const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.05), sampleRate);
				const data = buffer.getChannelData(0);
				for (let i = 0; i < data.length; i++) {
					data[i] = Math.random() * 2 - 1;
				}
				noise.buffer = buffer;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.08, t + 0.002);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

				const hp = ctx.createBiquadFilter();
				hp.type = 'highpass';
				hp.frequency.value = 250;

				const filter = ctx.createBiquadFilter();
				filter.type = 'lowpass';
				filter.frequency.value = 600;

				noise.connect(hp);
				hp.connect(filter);
				filter.connect(gain);
				gain.connect(masterGain);
				noise.start(t);
				noise.stop(t + 0.05);
			}
		}

		// === BRUSHED SNARE ===
		const snareBeats = [beatInterval, 3 * beatInterval];

		for (let measureStart = 0; measureStart < duration; measureStart += measureDuration) {
			for (const offset of snareBeats) {
				const t = measureStart + offset;
				if (t >= duration) break;

				const noise = ctx.createBufferSource();
				const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.08), sampleRate);
				const data = buffer.getChannelData(0);
				for (let i = 0; i < data.length; i++) {
					data[i] = Math.random() * 2 - 1;
				}
				noise.buffer = buffer;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.03, t + 0.002);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

				const filter = ctx.createBiquadFilter();
				filter.type = 'bandpass';
				filter.frequency.value = 3000;
				filter.Q.value = 1;

				noise.connect(filter);
				filter.connect(gain);
				gain.connect(masterGain);
				noise.start(t);
				noise.stop(t + 0.08);
			}
		}

		// === SHAKER ===
		const eighthNoteInterval = beatInterval / 2;

		for (let t = 0; t < duration; t += eighthNoteInterval) {
			const noise = ctx.createBufferSource();
			const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.02), sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < data.length; i++) {
				data[i] = Math.random() * 2 - 1;
			}
			noise.buffer = buffer;

			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.015, t + 0.002);
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

			const filter = ctx.createBiquadFilter();
			filter.type = 'highpass';
			filter.frequency.value = 5000;

			noise.connect(filter);
			filter.connect(gain);
			gain.connect(masterGain);
			noise.start(t);
			noise.stop(t + 0.02);
		}

		// === RHODES PIANO CHORDS ===
		const chords = [
			{
				time: 0,
				freqs: [220.0, 261.63, 329.63, 392.0, 493.88],
			},
			{
				time: measureDuration,
				freqs: [220.0, 261.63, 329.63, 392.0, 493.88, 587.33],
			},
			{
				time: 2 * measureDuration,
				freqs: [261.63, 329.63, 392.0, 493.88, 587.33],
			},
		];

		for (let loopStart = 0; loopStart < duration; loopStart += 3 * measureDuration) {
			for (const chord of chords) {
				const chordStart = loopStart + chord.time;
				if (chordStart >= duration) break;

				for (let i = 0; i < chord.freqs.length; i++) {
					const t = chordStart + i * 0.1;
					if (t >= duration) break;

					const osc = ctx.createOscillator();
					osc.type = 'triangle';
					osc.frequency.value = chord.freqs[i];

					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0, t);
					gain.gain.linearRampToValueAtTime(0.025, t + 0.04);
					gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

					const hp = ctx.createBiquadFilter();
					hp.type = 'highpass';
					hp.frequency.value = 200;

					const filter = ctx.createBiquadFilter();
					filter.type = 'lowpass';
					filter.frequency.value = 1600;

					osc.connect(hp);
					hp.connect(filter);
					filter.connect(gain);
					gain.connect(masterGain);
					osc.start(t);
					osc.stop(Math.min(t + 0.6, duration));
				}
			}
		}

		ctx.startRendering()
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
					[0, 45, durationInFrames - 45, durationInFrames],
					[0, 0.4, 0.4, 0],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			}
		/>
	);
};
