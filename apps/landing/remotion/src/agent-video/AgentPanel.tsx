import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';

export type AgentPanelMode = 'gap' | 'tool' | 'answer' | 'handoff' | 'morning';

const COLORS = {
	bg: 'rgba(10,10,15,0.88)',
	border: 'rgba(255,255,255,0.08)',
	ink: '#E8E9EE',
	inkSoft: '#9395A5',
	inkMuted: '#5C5F72',
	amber: '#E8A838',
	olive: '#4A9E7A',
	rust: '#B85C38',
	blue: '#314573',
	surface: 'rgba(255,255,255,0.04)',
};

const FONTS = {
	mono: "'SF Mono', SFMono-Regular, Menlo, monospace",
	sans: "'DM Sans', system-ui, sans-serif",
	serif: "'Cormorant Garamond', Georgia, serif",
};

const dotColors = ['#ff5f56', '#ffbd2e', '#27ca40'];

const typeText = (text: string, frame: number, startFrame: number, speed = 2) => {
	const chars = Math.max(0, Math.floor((frame - startFrame) / speed));
	return text.slice(0, chars);
};

const BlinkingCursor: React.FC<{frame: number; color?: string}> = ({
	frame,
	color = COLORS.ink,
}) => {
	const opacity = frame % 32 < 16 ? 1 : 0;
	return (
		<span
			style={{
				display: 'inline-block',
				width: 8,
				height: '1em',
				background: color,
				marginLeft: 2,
				verticalAlign: 'text-bottom',
				opacity,
			}}
		>
			{' '}
		</span>
	);
};

const reveal = (frame: number, startFrame: number, duration = 24) => {
	return interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
};

export const AgentPanel: React.FC<{mode: AgentPanelMode}> = ({mode}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const shellSpring = spring({
		frame,
		fps,
		config: {damping: 15, stiffness: 100},
	});

	const shellStyle: React.CSSProperties = {
		position: 'absolute',
		left: 760,
		top: 140,
		width: 980,
		minHeight: 720,
		borderRadius: 28,
		background: COLORS.bg,
		border: `1px solid ${COLORS.border}`,
		boxShadow: '0 34px 120px rgba(0,0,0,0.55)',
		fontFamily: FONTS.mono,
		fontSize: 15,
		lineHeight: 1.7,
		color: COLORS.ink,
		overflow: 'hidden',
		opacity: shellSpring,
		transform: `translate3d(0, ${(1 - shellSpring) * 20}px, 0)`,
		willChange: 'transform, opacity',
	};

	const header = (
		<div
			style={{
				background: COLORS.surface,
				padding: '14px 20px',
				display: 'flex',
				alignItems: 'center',
				gap: 8,
			}}
		>
			{dotColors.map((color, i) => (
				<div
					key={i}
					style={{
						width: 12,
						height: 12,
						borderRadius: '50%',
						background: color,
					}}
				/>
			))}
			<span
				style={{
					fontFamily: FONTS.sans,
					fontSize: 12,
					color: COLORS.inkMuted,
					marginLeft: 8,
					letterSpacing: '0.04em',
				}}
			>
				agent / local context
			</span>
		</div>
	);

	const promptText = 'what was I debugging yesterday around 3pm?';
	const promptStart = 20;
	const promptEnd = promptStart + promptText.length * 2;

	if (mode === 'gap') {
		const answerStart = promptEnd + 18;

		return (
			<div style={shellStyle}>
				{header}
				<div style={{padding: '28px 32px'}}>
					<div style={{color: COLORS.ink}}>
						{typeText(promptText, frame, promptStart, 2)}
						{frame >= promptStart && frame < promptEnd && (
							<BlinkingCursor frame={frame} />
						)}
					</div>
					<div
						style={{
							marginTop: 18,
							color: COLORS.inkMuted,
							opacity: reveal(frame, answerStart, 24),
						}}
					>
						I can see the repo.
						<br />
						But not what happened yesterday.
					</div>
				</div>
			</div>
		);
	}

	if (mode === 'tool') {
		const toolStart = promptEnd + 24;
		const thinkingStart = toolStart + 30;
		const successStart = thinkingStart + 24;

		return (
			<div style={shellStyle}>
				{header}
				<div style={{padding: '28px 32px'}}>
					<div style={{color: COLORS.ink}}>
						{typeText(promptText, frame, promptStart, 2)}
						{frame >= promptStart && frame < promptEnd && (
							<BlinkingCursor frame={frame} />
						)}
					</div>
					<div
						style={{
							marginTop: 18,
							color: COLORS.inkSoft,
							opacity: reveal(frame, toolStart, 24),
						}}
					>
						<pre
							style={{
								margin: 0,
								fontFamily: 'inherit',
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
							}}
						>
							{`· tool: escribano.search({
    when: "yesterday around 3pm",
    intent: "debugging"
  })`}
						</pre>
					</div>
					<div
						style={{
							marginTop: 14,
							color: COLORS.inkMuted,
							opacity: reveal(frame, thinkingStart, 24),
						}}
					>
						Searching local work memory…
					</div>
					<div
						style={{
							marginTop: 14,
							color: COLORS.olive,
							opacity: reveal(frame, successStart, 24),
						}}
					>
						✓ 12 observations found
					</div>
				</div>
			</div>
		);
	}

	if (mode === 'answer') {
		const summaryStart = promptEnd + 24;
		const answerStart = summaryStart + 30;
		const lineDelay = 18;

		const answerLines = [
			'You were debugging a refresh-token bug.',
			'',
			'Evidence:',
			'• auth/session.ts was edited at 14:32',
			'• pnpm test auth failed at 14:51',
			'• NextAuth callback docs opened at 15:02',
			'• Slack mentions recurring 401s',
		];

		return (
			<div style={shellStyle}>
				{header}
				<div style={{padding: '28px 32px'}}>
					<div style={{color: COLORS.ink}}>
						{typeText(promptText, frame, promptStart, 2)}
						{frame >= promptStart && frame < promptEnd && (
							<BlinkingCursor frame={frame} />
						)}
					</div>
					<div
						style={{
							marginTop: 12,
							color: COLORS.inkMuted,
							opacity: reveal(frame, summaryStart, 18),
						}}
					>
						✓ 12 observations found
					</div>
					<div style={{marginTop: 24}}>
						{answerLines.map((line, i) => (
							<div
								key={i}
								style={{
									color:
										line.startsWith('•') || line === 'Evidence:'
											? COLORS.inkSoft
											: COLORS.ink,
									opacity: reveal(frame, answerStart + i * lineDelay, 24),
								}}
							>
								{line}
							</div>
						))}
					</div>
				</div>
			</div>
		);
	}

	if (mode === 'handoff') {
		const handoffPrompt = 'write the handoff';
		const handoffPromptStart = 20;
		const handoffPromptEnd = handoffPromptStart + handoffPrompt.length * 2;
		const cardStart = handoffPromptEnd + 24;
		const pillsStart = cardStart + 30;

		const cardSpring = spring({
			frame: Math.max(0, frame - cardStart),
			fps,
			config: {damping: 15, stiffness: 100},
		});

		return (
			<div style={shellStyle}>
				{header}
				<div style={{padding: '28px 32px'}}>
					<div style={{color: COLORS.ink}}>
						{typeText(handoffPrompt, frame, handoffPromptStart, 2)}
						{frame >= handoffPromptStart && frame < handoffPromptEnd && (
							<BlinkingCursor frame={frame} />
						)}
					</div>
					<div
						style={{
							marginTop: 24,
							padding: 20,
							background: COLORS.surface,
							borderRadius: 12,
							border: `1px solid ${COLORS.border}`,
							opacity: cardSpring,
							transform: `translate3d(0, ${(1 - cardSpring) * 10}px, 0)`,
							willChange: 'transform, opacity',
						}}
					>
						<div
							style={{
								color: COLORS.amber,
								marginBottom: 8,
								fontWeight: 600,
								fontSize: 14,
							}}
						>
							Handoff:
						</div>
						<div style={{color: COLORS.inkSoft, whiteSpace: 'pre-wrap'}}>
							{`Investigated 401s caused by refresh-token expiry.
Reproduced with pnpm test auth.
Next: verify retry loop when provider returns 500.`}
						</div>
					</div>
					<div
						style={{
							marginTop: 20,
							display: 'flex',
							gap: 12,
							flexWrap: 'wrap',
						}}
					>
						{['Resume debugging', 'Prep standup', 'Recap meeting'].map(
							(pill, i) => (
								<div
									key={pill}
									style={{
										padding: '8px 16px',
										borderRadius: 20,
										background: COLORS.surface,
										border: `1px solid ${COLORS.border}`,
										color: COLORS.inkSoft,
										fontSize: 13,
										opacity: reveal(frame, pillsStart + i * 12, 18),
									}}
								>
									{pill}
								</div>
							),
						)}
					</div>
				</div>
			</div>
		);
	}

	if (mode === 'morning') {
		const headingStart = 20;
		const morningPromptStart = headingStart + 30;
		const morningPrompt = 'what should I pick back up?';
		const morningPromptEnd = morningPromptStart + morningPrompt.length * 2;
		const answerStart = morningPromptEnd + 24;

		return (
			<div style={shellStyle}>
				{header}
				<div style={{padding: '28px 32px'}}>
					<div
						style={{
							fontFamily: FONTS.serif,
							fontSize: 32,
							color: COLORS.ink,
							opacity: reveal(frame, headingStart, 24),
						}}
					>
						Good morning.
					</div>
					<div style={{marginTop: 24, color: COLORS.ink}}>
						{typeText(morningPrompt, frame, morningPromptStart, 2)}
						{frame >= morningPromptStart && frame < morningPromptEnd && (
							<BlinkingCursor frame={frame} />
						)}
					</div>
					<div
						style={{
							marginTop: 18,
							color: COLORS.inkSoft,
							opacity: reveal(frame, answerStart, 24),
						}}
					>
						Start with the auth retry loop. You left off after reproducing the
						failing test.
					</div>
				</div>
			</div>
		);
	}

	return null;
};
