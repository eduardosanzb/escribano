import React from 'react';
import {staticFile, Img, useCurrentFrame, interpolate} from 'remotion';
import {Terminal} from '../Terminal';
import {SCENES} from '../scenes';
import {enterExit, float} from '../motion';

const colors = {
	ink: '#E8E9EE',
	inkSoft: '#9395A5',
	inkMuted: '#5C5F72',
	bg: '#0E0F14',
	surface: '#15171F',
	elevated: '#1C1F2B',
	line: '#2A2D3A',
	amber: '#E8A838',
	olive: '#4A9E7A',
	rust: '#B85C38',
	blue: '#314573',
};

const serif = "'Cormorant Garamond', Georgia, serif";
const body = "'Spectral', Georgia, serif";
const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'SF Mono', SFMono-Regular, Menlo, monospace";

const Label: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
	children,
	style,
}) => (
	<div
		style={{
			fontFamily: sans,
			fontSize: 21,
			letterSpacing: 4,
			textTransform: 'uppercase',
			color: colors.inkMuted,
			...style,
		}}
	>
		{children}
	</div>
);

// Realistic typing: variable speed per word + pauses between words
const getCharsAtFrame = (frame: number): number => {
	const start = 20;
	let f = frame - start;
	if (f < 0) return 0;

	const segments: {text: string; charFrames: number; pauseFrames: number}[] = [
		{text: 'escribano-query', charFrames: 3, pauseFrames: 9},
		{text: ' recent', charFrames: 3, pauseFrames: 8},
		{text: ' --since', charFrames: 3, pauseFrames: 10},
		{text: ' 5m', charFrames: 2, pauseFrames: 0},
	];

	let chars = 0;
	for (const seg of segments) {
		const segDuration = seg.text.length * seg.charFrames + seg.pauseFrames;
		if (f >= segDuration) {
			chars += seg.text.length;
			f -= segDuration;
		} else {
			const typedInSeg = Math.floor(f / seg.charFrames);
			chars += Math.min(typedInSeg, seg.text.length);
			break;
		}
	}
	return chars;
};

// Suggestions that appear after each word is typed
const getSuggestion = (typedChars: number): string | null => {
	const e1 = 'escribano-query'.length;           // 15
	const e2 = e1 + ' recent'.length;              // 22
	const e3 = e2 + ' --since'.length;             // 30
	const e4 = e3 + ' 5m'.length;                  // 33

	if (typedChars >= e1 && typedChars < e2) return 'escribano-query recent';
	if (typedChars >= e2 && typedChars < e3) return 'escribano-query recent --since';
	if (typedChars >= e3 && typedChars < e4) return 'escribano-query recent --since 5m';
	return null;
};

export const AskScene: React.FC<{startFrame: number}> = ({startFrame}) => {
	const frame = useCurrentFrame();
	const relativeFrame = frame - startFrame;
	const visibility = enterExit(relativeFrame, 0, 25, 120, 150);

	const textOpacity = enterExit(relativeFrame, 5, 30, 120, 150);
	const titleOpacity = enterExit(relativeFrame, 10, 35, 120, 150);
	const bodyOpacity = enterExit(relativeFrame, 15, 40, 120, 150);

	const cmd = 'escribano-query recent --since 5m';
	const typedChars = getCharsAtFrame(relativeFrame);

	const screenshotTranslate = interpolate(
		relativeFrame,
		[0, 35],
		[60, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const screenshotRotate = interpolate(
		relativeFrame,
		[0, 35],
		[1, 0.4],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const suggestion = getSuggestion(typedChars);
	const suggestionOpacity = suggestion ? 0.25 : 0;

	return (
		<div style={{opacity: visibility}}>
			{/* Text block at left */}
			<div
				style={{
					position: 'absolute',
					left: 126,
					top: 262,
					width: 520,
				}}
			>
				<div style={{opacity: textOpacity}}>
					<Label>Query</Label>
				</div>
				<div
					style={{
						marginTop: 26,
						fontFamily: serif,
						fontSize: 74,
						lineHeight: 0.96,
						fontWeight: 400,
						opacity: titleOpacity,
					}}
				>
					Query, on your terms
				</div>
				<div
					style={{
						marginTop: 28,
						fontFamily: body,
						fontSize: 32,
						lineHeight: 1.36,
						color: colors.inkSoft,
						opacity: bodyOpacity,
					}}
				>
					Ask your agent — or the command line directly — what you were
					working on. Escribano returns the evidence, cleanly structured,
					ready to cite.
				</div>
				<div
					style={{
						marginTop: 46,
						width: 290,
						height: 2,
						background: colors.amber,
						opacity: 0.7 * enterExit(relativeFrame, 20, 45, 120, 150),
					}}
				/>
			</div>

			{/* Screenshot at right */}
			<div
				style={{
					position: 'absolute',
					left: 818,
					top: 128 + float(relativeFrame, 130, 7),
					width: 760,
					borderRadius: 28,
					overflow: 'hidden',
					background: '#050506',
					boxShadow: '0 34px 120px rgba(0,0,0,0.5)',
					border: '1px solid rgba(255,255,255,0.08)',
					transform: `translateX(${screenshotTranslate}px) rotate(${screenshotRotate}deg)`,
				}}
			>
				<Img
					src={staticFile('assets/query-json.png')}
					style={{display: 'block', width: '100%'}}
				/>
			</div>

			{/* Command suggestion hints above typing area */}
			{suggestion && (
				<div
					style={{
						position: 'absolute',
						left: 950,
						bottom: 240,
						fontFamily: mono,
						fontSize: 18,
						color: colors.inkMuted,
						opacity: suggestionOpacity,
						whiteSpace: 'nowrap',
					}}
				>
					Try: {suggestion}
				</div>
			)}

			{/* Command-line typing animation at bottom-left */}
			<div
				style={{
					position: 'absolute',
					left: 920,
					bottom: 150,
					width: 640,
					borderRadius: 22,
					padding: '24px 30px',
					background: 'rgba(28,31,43,0.92)',
					border: `1px solid ${colors.line}`,
					fontFamily: mono,
					fontSize: 27,
					color: colors.ink,
				}}
			>
				<span style={{color: colors.amber}}>$ </span>
				{cmd.slice(0, typedChars)}
				{/* cursor trail */}
				<span
					style={{
						opacity: relativeFrame % 30 < 15 ? 0.15 : 0,
						position: 'absolute',
						marginLeft: -2,
					}}
				>
					|
				</span>
				{/* Main cursor */}
				<span style={{opacity: relativeFrame % 30 < 15 ? 1 : 0}}>|</span>
			</div>
		</div>
	);
};
