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
	const [handle] = useState(() => delayRender('Generating bossa nova audio'));
	const [audioBuffer, setAudioBuffer] = useState<string | null>(null);

	useEffect(() => {
		const sampleRate = 44100;
		const length = Math.floor(sampleRate * (durationInFrames / fps));
		const ctx = new OfflineAudioContext(2, length, sampleRate);
		const duration = durationInFrames / fps;

		// Master chain
		const masterGain = ctx.createGain();
		const masterComp = ctx.createDynamicsCompressor();
		masterComp.threshold.value = -12;
		masterComp.knee.value = 6;
		masterComp.ratio.value = 4;
		masterComp.attack.value = 0.003;
		masterComp.release.value = 0.1;
		masterGain.connect(masterComp);
		masterComp.connect(ctx.destination);

		// Volume envelope: fade in 0→0.25 over 2s, hold, fade out over 2s
		masterGain.gain.setValueAtTime(0, 0);
		masterGain.gain.linearRampToValueAtTime(0.25, Math.min(2, duration));
		if (duration > 4) {
			masterGain.gain.setValueAtTime(0.25, duration - 2);
		}
		masterGain.gain.linearRampToValueAtTime(0, duration);

		// Sidechain gain (ducked by conga for bass)
		const sidechainGain = ctx.createGain();
		sidechainGain.gain.value = 1.0;
		sidechainGain.connect(masterGain);

		const bpm = 90;
		const beatInterval = 60 / bpm;
		const measureDuration = 4 * beatInterval;

		// === UPRIGHT BASS (root notes, long sustain) ===
		const bassRoots = [
			{time: 0, freq: 73.42, duration: 1.5},
			{time: measureDuration, freq: 49.0, duration: 1.5},
			{time: 2 * measureDuration, freq: 65.41, duration: 1.5},
		];

		for (let loopStart = 0; loopStart < duration; loopStart += 3 * measureDuration) {
			for (const note of bassRoots) {
				const t = loopStart + note.time;
				if (t >= duration) break;

				const osc = ctx.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = note.freq;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.1, t);
				gain.gain.setTargetAtTime(0.001, t + 0.1, 0.4);

				osc.connect(gain);
				gain.connect(sidechainGain);
				osc.start(t);
				osc.stop(Math.min(t + note.duration, duration));
			}
		}

		// === CONGA (tumbao pattern) ===
		const congaHits: number[] = [];
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
				congaHits.push(t);

				const noise = ctx.createBufferSource();
				const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.05), sampleRate);
				const data = buffer.getChannelData(0);
				for (let i = 0; i < data.length; i++) {
					data[i] = Math.random() * 2 - 1;
				}
				noise.buffer = buffer;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.08, t);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

				const filter = ctx.createBiquadFilter();
				filter.type = 'lowpass';
				filter.frequency.value = 600;

				noise.connect(filter);
				filter.connect(gain);
				gain.connect(masterGain);
				noise.start(t);
				noise.stop(t + 0.05);
			}
		}

		// Sidechain ducking from conga (10% dip, very subtle)
		for (const t of congaHits) {
			sidechainGain.gain.setValueAtTime(1.0, t);
			sidechainGain.gain.linearRampToValueAtTime(0.9, t + 0.02);
			sidechainGain.gain.linearRampToValueAtTime(1.0, t + 0.1);
		}

		// === BRUSHED SNARE (backbeat on 2 and 4) ===
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
				gain.gain.setValueAtTime(0.03, t);
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

		// === SHAKER (every eighth note) ===
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
			gain.gain.setValueAtTime(0.015, t);
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

		// === RHODES PIANO CHORDS (arpeggios) ===
		const chords = [
			{
				time: 0,
				freqs: [146.83, 174.61, 220.0, 261.63, 329.63],
			},
			{
				time: measureDuration,
				freqs: [98.0, 123.47, 146.83, 174.61, 220.0, 329.63],
			},
			{
				time: 2 * measureDuration,
				freqs: [130.81, 164.81, 196.0, 246.94, 293.66],
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
					osc.type = 'sine';
					osc.frequency.value = chord.freqs[i];

					const osc2 = ctx.createOscillator();
					osc2.type = 'sine';
					osc2.frequency.value = chord.freqs[i];
					osc2.detune.value = 5;

					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0.04, t);
					gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

					const filter = ctx.createBiquadFilter();
					filter.type = 'lowpass';
					filter.frequency.value = 2000;

					osc.connect(filter);
					osc2.connect(filter);
					filter.connect(gain);
					gain.connect(masterGain);
					osc.start(t);
					osc.stop(Math.min(t + 0.6, duration));
					osc2.start(t);
					osc2.stop(Math.min(t + 0.6, duration));
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
