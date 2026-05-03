import React from 'react';
import {spring} from 'remotion';

interface ThinkingBlockProps {
	frame: number;
	startFrame: number;
}

const FONTS = {
	mono: "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace",
	sans: "'DM Sans', system-ui, sans-serif",
};

const typeText = (text: string, frame: number, startFrame: number, speed = 1) => {
	const words = text.split(' ');
	const visibleCount = Math.max(0, Math.floor((frame - startFrame) / speed));
	return words.slice(0, visibleCount).join(' ');
};

interface CliCall {
	command: string;
	output: string[];
}

const cliCalls: CliCall[] = [
	{
		command: '$ escribano-query recent --since 4h --compact',
		output: [
			'14:32  Browser  pgvector documentation',
			'14:41  Browser  Pinecone pricing page',
			'14:52  VS Code   notes.md with comparison table',
			'14:58  Terminal  docker compose up',
			'15:03  Slack     "benchmark pgvector?"',
		],
	},
	{
		command: '$ escribano-query search "pgvector" --since 4h --latest',
		output: [
			'14:52  Browser  "pgvector: 1000 QPS at 1M vectors"',
		],
	},
];

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({frame, startFrame}) => {
	const relativeFrame = frame - startFrame;

	// Block fade in: frames 0-12
	const blockOpacity = Math.min(1, Math.max(0, relativeFrame / 12));

	// Amber dot pulse
	const dotOpacity = 0.4 + 0.6 * Math.sin(frame / 10);

	// Narrative text
	const narrativeText =
		'The user wants a summary of their research on vector databases from this afternoon. Let me query Escribano for recent activity.';
	const narrativeStartFrame = startFrame + 12;
	const visibleNarrative = typeText(narrativeText, frame, narrativeStartFrame, 1);

	// CLI calls timing
	const cliStartFrames = [startFrame + 80, startFrame + 280];
	const cliDelayBetweenCalls = 200; // frames between CLI calls

	// Success line
	const successStartFrame = startFrame + 480;
	const successOpacity = Math.min(1, Math.max(0, (frame - successStartFrame) / 18));

	return (
		<div
			style={{
				background: 'rgba(237, 229, 212, 0.6)',
				border: '1px solid rgba(26, 22, 18, 0.08)',
				borderRadius: 12,
				padding: '20px 24px',
				marginTop: 16,
				fontFamily: FONTS.mono,
				fontSize: 20,
				lineHeight: 1.6,
				color: '#7a6e66',
				opacity: blockOpacity,
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
							opacity: dotOpacity,
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

			{/* Thinking narrative */}
			<div style={{marginBottom: 12}}>{visibleNarrative}</div>

			{/* CLI calls */}
			{cliCalls.map((cli, cliIndex) => {
				const cliStartFrame = cliStartFrames[cliIndex];
				const cliRelativeFrame = frame - cliStartFrame;
				
				if (cliRelativeFrame < 0) return null;

				return (
					<div key={cliIndex} style={{marginBottom: cliIndex < cliCalls.length - 1 ? 16 : 0}}>
						{/* Command */}
						<div
							style={{
								borderLeft: '2px solid #b85c38',
								background: 'rgba(26, 22, 18, 0.03)',
								padding: '10px 14px',
								marginBottom: 8,
							fontFamily: FONTS.mono,
							fontSize: 17,
								color: '#7a6e66',
								opacity: Math.min(1, Math.max(0, cliRelativeFrame / 8)),
							}}
						>
							{cli.command}
						</div>

						{/* Output */}
						<div style={{paddingLeft: 16}}>
							{cli.output.map((line, lineIndex) => {
								const lineStartFrame = cliStartFrame + 20 + lineIndex * 10;
								const progress = spring({
									frame: Math.max(0, frame - lineStartFrame),
									fps: 60,
									config: {damping: 25, stiffness: 120, mass: 0.6},
								});
								
								return (
									<div
										key={lineIndex}
										style={{
											transform: `translateX(${(1 - progress) * -20}px)`,
											opacity: progress,
											marginBottom: 2,
											fontSize: 15,
										}}
									>
										{line}
									</div>
								);
							})}
						</div>
					</div>
				);
			})}

			{/* Success line */}
			{relativeFrame >= 480 && (
				<div
					style={{
						color: '#5c6b3a',
						opacity: successOpacity,
					fontFamily: FONTS.mono,
					fontSize: 19,
						marginTop: 12,
					}}
				>
					✓ 8 observations found
				</div>
			)}
		</div>
	);
};
