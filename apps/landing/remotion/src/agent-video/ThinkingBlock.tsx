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

	// Tool call block
	const toolCallLines = [
		'· tool: escribano.search({',
		'    when: "this afternoon",',
		'    intent: "research",',
		'    topic: "vector databases"',
		'  })',
	];
	const toolCallStartFrame = startFrame + 90;

	// Evidence items
	const evidence = [
		{time: '14:32', source: 'Browser', title: 'pgvector docs'},
		{time: '14:41', source: 'Browser', title: 'Pinecone pricing'},
		{time: '14:52', source: 'VS Code', title: 'notes.md'},
		{time: '14:58', source: 'Terminal', title: 'docker compose up'},
		{time: '15:03', source: 'Slack', title: '"benchmark pgvector?"'},
	];
	const evidenceStartFrame = startFrame + 150;
	const evidenceStagger = 10;

	// Success line
	const successStartFrame = startFrame + 260;
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
				fontSize: 13,
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
						fontSize: 11,
						color: '#b85c38',
					}}
				>
					🔒 Local only
				</span>
			</div>

			{/* Thinking narrative */}
			<div style={{marginBottom: 12}}>{visibleNarrative}</div>

			{/* Tool call block */}
			{relativeFrame >= 90 && (
				<div
					style={{
						borderLeft: '2px solid #b85c38',
						background: 'rgba(26, 22, 18, 0.03)',
						padding: '12px 16px',
						marginBottom: 12,
						fontFamily: FONTS.mono,
						fontSize: 13,
						lineHeight: 1.6,
						color: '#7a6e66',
					}}
				>
					{toolCallLines.map((line, i) => {
						const lineStartFrame = toolCallStartFrame + i * 8;
						const lineOpacity = Math.min(1, Math.max(0, (frame - lineStartFrame) / 8));
						return (
							<div
								key={i}
								style={{
									opacity: lineOpacity,
									whiteSpace: 'pre',
								}}
							>
								{line}
							</div>
						);
					})}
				</div>
			)}

			{/* Evidence items */}
			{relativeFrame >= 150 && (
				<div style={{marginBottom: 12}}>
					{evidence.map((item, i) => {
						const itemStartFrame = evidenceStartFrame + i * evidenceStagger;
						const progress = spring({
							frame: Math.max(0, frame - itemStartFrame),
							fps: 60,
							config: {damping: 25, stiffness: 120, mass: 0.6},
						});
						return (
							<div
								key={i}
								style={{
									transform: `translateX(${(1 - progress) * -30}px)`,
									opacity: progress,
									display: 'flex',
									gap: 12,
									marginBottom: 4,
								}}
							>
								<span
									style={{
										fontFamily: FONTS.mono,
										color: '#7a6e66',
										fontSize: 11,
										minWidth: 40,
									}}
								>
									{item.time}
								</span>
								<span
									style={{
										fontFamily: FONTS.sans,
										color: '#5c6b3a',
										fontSize: 11,
										minWidth: 60,
									}}
								>
									{item.source}
								</span>
								<span
									style={{
										fontFamily: FONTS.sans,
										color: '#3d3530',
										fontSize: 12,
										fontWeight: 500,
									}}
								>
									{item.title}
								</span>
							</div>
						);
					})}
				</div>
			)}

			{/* Success line */}
			{relativeFrame >= 260 && (
				<div
					style={{
						color: '#5c6b3a',
						opacity: successOpacity,
						fontFamily: FONTS.mono,
						fontSize: 13,
					}}
				>
					✓ 14 observations found
				</div>
			)}
		</div>
	);
};
