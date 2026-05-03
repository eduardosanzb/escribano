import React from 'react';
import {interpolate, spring} from 'remotion';

interface MiniCliCallProps {
	frame: number;
	startFrame: number;
}

const FONTS = {
	mono: "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace",
	sans: "'DM Sans', system-ui, sans-serif",
};

export const MiniCliCall: React.FC<MiniCliCallProps> = ({
	frame,
	startFrame,
}) => {
	const relativeFrame = frame - startFrame;

	const command = '$ escribano-query search "docker pgvector" --since 4h --latest';
	const output = '14:58  Terminal  docker compose up pgvector ✓';

	const commandOpacity = interpolate(
		frame,
		[startFrame, startFrame + 8],
		[0, 1],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const outputProgress = spring({
		frame: Math.max(0, frame - (startFrame + 20)),
		fps: 60,
		config: {damping: 25, stiffness: 120, mass: 0.6},
	});

	return (
		<div
			style={{
				background: 'rgba(237, 229, 212, 0.6)',
				border: '1px solid rgba(26, 22, 18, 0.08)',
				borderRadius: 12,
				padding: '20px 24px',
				marginTop: 16,
			fontFamily: FONTS.mono,
			fontSize: 19,
				lineHeight: 1.6,
				color: '#7a6e66',
				opacity: commandOpacity,
			}}
		>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					marginBottom: 12,
				}}
			>
				<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
					<div
						style={{
							width: 4,
							height: 4,
							borderRadius: '50%',
							background: '#c4963a',
							opacity: 0.4 + 0.6 * Math.sin(frame / 10),
						}}
					/>
					<span>thinking:</span>
				</div>
				<span
					style={{
					fontFamily: FONTS.sans,
					fontSize: 15,
						color: '#b85c38',
					}}
				>
					🔒 Local only
				</span>
			</div>

			<div
				style={{
					borderLeft: '2px solid #b85c38',
					background: 'rgba(26, 22, 18, 0.03)',
					padding: '8px 12px',
					marginBottom: 6,
					opacity: commandOpacity,
				}}
			>
				{command}
			</div>
			<div
				style={{
					paddingLeft: 16,
					transform: `translateX(${(1 - outputProgress) * -20}px)`,
					opacity: outputProgress,
				}}
			>
				{output}
			</div>
			{relativeFrame >= 50 && (
				<div
					style={{
						marginTop: 8,
					color: '#5c6b3a',
					fontSize: 15,
						opacity: interpolate(
							frame,
							[startFrame + 50, startFrame + 62],
							[0, 1],
							{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
						),
					}}
				>
					✓ Local test confirmed
				</div>
			)}
		</div>
	);
};
