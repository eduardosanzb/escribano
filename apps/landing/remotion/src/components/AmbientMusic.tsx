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
	const [handle] = useState(() => delayRender('Generating energetic audio'));
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

		// Volume envelope: fade in 0→0.35 over 2s, hold, fade out over 2s
		masterGain.gain.setValueAtTime(0, 0);
		masterGain.gain.linearRampToValueAtTime(0.35, Math.min(2, duration));
		if (duration > 4) {
			masterGain.gain.setValueAtTime(0.35, duration - 2);
		}
		masterGain.gain.linearRampToValueAtTime(0, duration);

		// Sidechain gain (ducked by kick)
		const sidechainGain = ctx.createGain();
		sidechainGain.gain.value = 1.0;
		sidechainGain.connect(masterGain);

		// === KICK DRUM (4-on-the-floor, 120 BPM = every 0.5s) ===
		const bpm = 120;
		const beatInterval = 60 / bpm;

		for (let t = 0; t < duration; t += beatInterval) {
			// Kick body: sine sweep
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(150, t);
			osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);

			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0.8, t);
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

			osc.connect(gain);
			gain.connect(masterGain);
			osc.start(t);
			osc.stop(t + 0.3);

			// Click/transient
			const click = ctx.createOscillator();
			click.type = 'square';
			click.frequency.setValueAtTime(800, t);
			click.frequency.exponentialRampToValueAtTime(100, t + 0.02);
			const clickGain = ctx.createGain();
			clickGain.gain.setValueAtTime(0.15, t);
			clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
			click.connect(clickGain);
			clickGain.connect(masterGain);
			click.start(t);
			click.stop(t + 0.06);

			// Sidechain duck: dip music by 40% for 150ms after kick
			sidechainGain.gain.setValueAtTime(1.0, t);
			sidechainGain.gain.linearRampToValueAtTime(0.6, t + 0.02);
			sidechainGain.gain.linearRampToValueAtTime(1.0, t + 0.15);
		}

		// === BASSLINE (quarter notes, root of each chord) ===
		const bassNotes = [
			{time: 0, freq: 65.41, duration: 0.45},   // C2
			{time: 0.5, freq: 65.41, duration: 0.45},
			{time: 1.0, freq: 65.41, duration: 0.45},
			{time: 1.5, freq: 65.41, duration: 0.45},
			{time: 2.0, freq: 55.0, duration: 0.45},   // A1
			{time: 2.5, freq: 55.0, duration: 0.45},
			{time: 3.0, freq: 55.0, duration: 0.45},
			{time: 3.5, freq: 55.0, duration: 0.45},
			{time: 4.0, freq: 43.65, duration: 0.45},  // F1
			{time: 4.5, freq: 43.65, duration: 0.45},
			{time: 5.0, freq: 43.65, duration: 0.45},
			{time: 5.5, freq: 43.65, duration: 0.45},
		];

		// Loop bassline for full duration
		const loopDuration = 6; // seconds per chord cycle
		for (let loopStart = 0; loopStart < duration; loopStart += loopDuration) {
			for (const note of bassNotes) {
				const t = loopStart + note.time;
				if (t >= duration) break;

				const osc = ctx.createOscillator();
				osc.type = 'sawtooth';
				osc.frequency.value = note.freq;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.12, t);
				gain.gain.setTargetAtTime(0.001, t + 0.05, 0.15);

				const filter = ctx.createBiquadFilter();
				filter.type = 'lowpass';
				filter.frequency.value = 400;
				filter.Q.value = 1;

				osc.connect(filter);
				filter.connect(gain);
				gain.connect(sidechainGain);
				osc.start(t);
				osc.stop(Math.min(t + note.duration, duration));
			}
		}

		// === CHORD STABS (sawtooth, staccato) ===
		const chords = [
			{time: 0, freqs: [130.81, 196.0, 261.63]},
			{time: 2, freqs: [110.0, 164.81, 220.0]},
			{time: 4, freqs: [87.31, 130.81, 174.61]},
		];

		for (let loopStart = 0; loopStart < duration; loopStart += 6) {
			for (const chord of chords) {
				const t = loopStart + chord.time;
				if (t >= duration) break;

				for (const freq of chord.freqs) {
					const osc = ctx.createOscillator();
					osc.type = 'sawtooth';
					osc.frequency.value = freq;

					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0.04, t);
					gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

					const filter = ctx.createBiquadFilter();
					filter.type = 'lowpass';
					filter.frequency.setValueAtTime(2000, t);
					filter.frequency.exponentialRampToValueAtTime(600, t + 0.5);

					osc.connect(filter);
					filter.connect(gain);
					gain.connect(sidechainGain);
					osc.start(t);
					osc.stop(Math.min(t + 1, duration));
				}
			}
		}

		// === HI-HATS (off-beats) ===
		for (let t = 0; t < duration; t += beatInterval) {
			const hatTime = t + beatInterval / 2; // off-beat
			if (hatTime >= duration) break;

			const noise = ctx.createBufferSource();
			const buffer = ctx.createBuffer(1, sampleRate * 0.1, sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < data.length; i++) {
				data[i] = Math.random() * 2 - 1;
			}
			noise.buffer = buffer;

			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0.06, hatTime);
			gain.gain.exponentialRampToValueAtTime(0.001, hatTime + 0.05);

			const filter = ctx.createBiquadFilter();
			filter.type = 'highpass';
			filter.frequency.value = 8000;

			noise.connect(filter);
			filter.connect(gain);
			gain.connect(masterGain);
			noise.start(hatTime);
			noise.stop(hatTime + 0.1);
		}

		// === SHIMMER/PAD (sustained, low volume) ===
		for (let loopStart = 0; loopStart < duration; loopStart += 6) {
			for (let i = 0; i < 3; i++) {
				const t = loopStart + i * 2;
				if (t >= duration) break;
				const rootFreq = chords[i].freqs[0];

				const osc = ctx.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = rootFreq * 2;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.02, t);
				gain.gain.linearRampToValueAtTime(0.015, t + 1.5);
				gain.gain.linearRampToValueAtTime(0.001, t + 2);

				osc.connect(gain);
				gain.connect(sidechainGain);
				osc.start(t);
				osc.stop(Math.min(t + 2, duration));
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
