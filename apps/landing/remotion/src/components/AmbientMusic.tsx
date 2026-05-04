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
		masterComp.threshold.value = -22;
		masterComp.knee.value = 6;
		masterComp.ratio.value = 3;
		masterComp.attack.value = 0.01;
		masterComp.release.value = 0.16;
		masterGain.connect(masterComp);
		masterComp.connect(ctx.destination);

		// Volume envelope: fade in 0→0.24 over 2s, hold, fade out over 2s
		masterGain.gain.setValueAtTime(0, 0);
		masterGain.gain.linearRampToValueAtTime(0.24, Math.min(2, duration));
		if (duration > 4) {
			masterGain.gain.setValueAtTime(0.24, duration - 2);
		}
		masterGain.gain.linearRampToValueAtTime(0, duration);

		// Sidechain gain (ducked by conga for bass)
		const sidechainGain = ctx.createGain();
		sidechainGain.gain.value = 1.0;
		sidechainGain.connect(masterGain);

		const bpm = 90;
		const beatInterval = 60 / bpm;
		const measureDuration = 4 * beatInterval;

		// === MUTED BASS PULSE (kept out of sub-bass for laptop/phone speakers) ===
		const bassRoots = [
			{time: 0, freq: 293.66, duration: 0.5},
			{time: measureDuration, freq: 196.0, duration: 0.5},
			{time: 2 * measureDuration, freq: 261.63, duration: 0.5},
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
				gain.gain.setValueAtTime(0.0001, t);
				gain.gain.linearRampToValueAtTime(0.018, t + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, end);

				osc.connect(gain);
				gain.connect(sidechainGain);
				osc.start(t);
				osc.stop(end);
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
				gain.gain.setValueAtTime(0.0001, t);
				gain.gain.linearRampToValueAtTime(0.045, t + 0.004);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

				const rumbleCut = ctx.createBiquadFilter();
				rumbleCut.type = 'highpass';
				rumbleCut.frequency.value = 260;

				const filter = ctx.createBiquadFilter();
				filter.type = 'bandpass';
				filter.frequency.value = 620;
				filter.Q.value = 1.2;

				noise.connect(rumbleCut);
				rumbleCut.connect(filter);
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
				gain.gain.setValueAtTime(0.0001, t);
				gain.gain.linearRampToValueAtTime(0.024, t + 0.004);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

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
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.linearRampToValueAtTime(0.012, t + 0.003);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);

			const filter = ctx.createBiquadFilter();
			filter.type = 'highpass';
			filter.frequency.value = 5000;

			noise.connect(filter);
			filter.connect(gain);
			gain.connect(masterGain);
			noise.start(t);
			noise.stop(t + 0.02);
		}

		// === SOFT HARP (upper-register arpeggios) ===
		// Keep this away from laptop-speaker resonance: single oscillator, no detune,
		// no low fundamentals, gentle attack, and a short release.
		const harpChords = [
			{
				time: 0,
				freqs: [392.0, 440.0, 493.88, 587.33, 659.25],
			},
			{
				time: measureDuration,
				freqs: [329.63, 392.0, 440.0, 493.88, 659.25],
			},
			{
				time: 2 * measureDuration,
				freqs: [349.23, 440.0, 493.88, 587.33, 698.46],
			},
		];

		for (let loopStart = 0; loopStart < duration; loopStart += 3 * measureDuration) {
			for (const chord of harpChords) {
				const chordStart = loopStart + chord.time;
				if (chordStart >= duration) break;

				for (let i = 0; i < chord.freqs.length; i++) {
					const t = chordStart + i * 0.13;
					if (t >= duration) break;

					const osc = ctx.createOscillator();
					osc.type = 'triangle';
					osc.frequency.value = chord.freqs[i];

					const tone = ctx.createBiquadFilter();
					tone.type = 'lowpass';
					tone.frequency.value = 1400;
					tone.Q.value = 0.6;

					const bodyCut = ctx.createBiquadFilter();
					bodyCut.type = 'highpass';
					bodyCut.frequency.value = 300;

					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0.0001, t);
					gain.gain.linearRampToValueAtTime(0.012, t + 0.04);
					gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

					osc.connect(tone);
					tone.connect(bodyCut);
					bodyCut.connect(gain);
					gain.connect(masterGain);
					osc.start(t);
					osc.stop(Math.min(t + 0.9, duration));
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
					[0, 0.65, 0.65, 0],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			}
		/>
	);
};
