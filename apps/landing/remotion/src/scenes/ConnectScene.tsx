import React from 'react';
import {useCurrentFrame, interpolate} from 'remotion';
import {enterExit} from '../motion';

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
const mono = "'Fira Code', 'SF Mono', monospace";

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

interface MomentCardProps {
	time: string;
	app: string;
	description: string;
	delay: number;
	frame: number;
}

const MomentCard: React.FC<MomentCardProps> = ({time, app, description, delay, frame}) => {
	const translateX = interpolate(
		frame - delay,
		[0, 30],
		[60, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const opacity = interpolate(
		frame - delay,
		[0, 30],
		[0, 1],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	return (
		<div
			style={{
				width: 520,
				padding: '20px 24px',
				borderRadius: 16,
				background: 'rgba(28,31,43,0.6)',
				border: '1px solid rgba(255,255,255,0.08)',
				transform: `translateX(${translateX}px)`,
				opacity,
				willChange: 'transform, opacity',
			}}
		>
			<div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8}}>
				<span style={{fontFamily: mono, fontSize: 14, color: colors.amber}}>{time}</span>
				<span style={{color: colors.inkSoft}}>·</span>
				<span style={{fontFamily: sans, fontSize: 14, color: colors.inkSoft}}>{app}</span>
			</div>
			<div style={{fontFamily: body, fontSize: 24, color: colors.ink, lineHeight: 1.3}}>
				{description}
			</div>
		</div>
	);
};

export const ConnectScene: React.FC<{startFrame: number}> = ({startFrame}) => {
	const frame = useCurrentFrame();
	const relativeFrame = frame - startFrame;

	const visibility = enterExit(relativeFrame, 0, 25, 150, 190);

	const textOpacity = enterExit(relativeFrame, 5, 25, 150, 190);
	const titleOpacity = enterExit(relativeFrame, 10, 35, 150, 190);
	const bodyOpacity = enterExit(relativeFrame, 20, 45, 150, 190);

	return (
		<div style={{opacity: visibility, willChange: 'transform, opacity'}}>
			{/* Text block at left */}
			<div
				style={{
					position: 'absolute',
					left: 126,
					top: 262,
					width: 520,
					willChange: 'transform, opacity',
				}}
			>
				<div style={{opacity: textOpacity, willChange: 'transform, opacity'}}>
					<Label>Understand</Label>
				</div>
				<div
					style={{
						marginTop: 26,
						fontFamily: serif,
						fontSize: 74,
						lineHeight: 0.96,
						fontWeight: 400,
						opacity: titleOpacity,
						willChange: 'transform, opacity',
					}}
				>
					Understand, on-device
				</div>
				<div
					style={{
						marginTop: 28,
						fontFamily: body,
						fontSize: 32,
						lineHeight: 1.36,
						color: colors.inkSoft,
						opacity: bodyOpacity,
						willChange: 'transform, opacity',
					}}
				>
					Each moment is turned into a short, plain-language description — the tools, the files, the context. All of it stays on your machine.
				</div>
			</div>

			{/* Moment cards at right */}
			<div
				style={{
					position: 'absolute',
					left: 850,
					top: 180,
					display: 'flex',
					flexDirection: 'column',
					gap: 20,
				}}
			>
				<MomentCard
					time="14:32"
					app="VS Code"
					description="Debugging a JWT refresh flow in middleware/auth.ts — repeated 401 responses in the inspector"
					delay={20}
					frame={relativeFrame}
				/>
				<MomentCard
					time="14:47"
					app="Terminal"
					description="Committed the fix for refresh-token expiry and pushed to the feature branch"
					delay={35}
					frame={relativeFrame}
				/>
				<MomentCard
					time="16:40"
					app="GitHub"
					description="Reviewing PR #214 with auth changes"
					delay={50}
					frame={relativeFrame}
				/>
			</div>
		</div>
	);
};
