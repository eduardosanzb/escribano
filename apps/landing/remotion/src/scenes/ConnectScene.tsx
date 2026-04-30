import React from 'react';
import {staticFile, Img, useCurrentFrame, interpolate} from 'remotion';
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

export const ConnectScene: React.FC<{startFrame: number}> = ({startFrame}) => {
	const frame = useCurrentFrame();
	const relativeFrame = frame - startFrame;

	const visibility = enterExit(relativeFrame, 0, 25, 120, 150);

	const textOpacity = enterExit(relativeFrame, 5, 30, 120, 150);
	const titleOpacity = enterExit(relativeFrame, 10, 35, 120, 150);
	const bodyOpacity = enterExit(relativeFrame, 15, 40, 120, 150);

	const underlineWidth = interpolate(
		relativeFrame,
		[40, 70],
		[0, 290],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const screenshotX = interpolate(
		relativeFrame,
		[0, 30],
		[820, 720],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const screenshotY = 178 + float(relativeFrame, 140, 5);

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
					<Label>Connect</Label>
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
					Agents learn where to ask.
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
					Claude Code, Cursor, Codex, Gemini, OpenCode. One local skill,
					installed into the tools already in use.
				</div>
				<div
					style={{
						marginTop: 46,
						width: underlineWidth,
						height: 2,
						background: colors.amber,
						opacity: 0.7,
					}}
				/>
			</div>

			{/* Screenshot at right */}
			<div
				style={{
					position: 'absolute',
					left: screenshotX,
					top: screenshotY,
					width: 1050,
					borderRadius: 28,
					overflow: 'hidden',
					background: '#050506',
					boxShadow: '0 34px 120px rgba(0,0,0,0.5)',
					border: '1px solid rgba(255,255,255,0.08)',
				}}
			>
				<Img
					src={staticFile('assets/agents.png')}
					style={{display: 'block', width: '100%'}}
				/>
			</div>

			{/* Floating agent badges */}
			<div
				style={{
					position: 'absolute',
					left: 760 + float(relativeFrame, 90, 3),
					top: 160 + float(relativeFrame, 110, 4),
					width: 24,
					height: 24,
					borderRadius: 999,
					background: colors.amber,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: sans,
					fontSize: 12,
					fontWeight: 500,
					color: '#fff',
				}}
			>
				C
			</div>
			<div
				style={{
					position: 'absolute',
					left: 1680 + float(relativeFrame, 120, 4),
					top: 200 + float(relativeFrame, 80, 3),
					width: 24,
					height: 24,
					borderRadius: 999,
					background: colors.olive,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: sans,
					fontSize: 12,
					fontWeight: 500,
					color: '#fff',
				}}
			>
				G
			</div>
			<div
				style={{
					position: 'absolute',
					left: 1640 + float(relativeFrame, 100, 5),
					top: 720 + float(relativeFrame, 130, 3),
					width: 24,
					height: 24,
					borderRadius: 999,
					background: colors.rust,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: sans,
					fontSize: 12,
					fontWeight: 500,
					color: '#fff',
				}}
			>
				O
			</div>
			<div
				style={{
					position: 'absolute',
					left: 740 + float(relativeFrame, 110, 4),
					top: 680 + float(relativeFrame, 90, 5),
					width: 24,
					height: 24,
					borderRadius: 999,
					background: colors.amber,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: sans,
					fontSize: 12,
					fontWeight: 500,
					color: '#fff',
				}}
			>
				X
			</div>
		</div>
	);
};
