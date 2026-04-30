export function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function soft(value: number): number {
	const x = clamp(value);
	return x * x * (3 - 2 * x);
}

export function enterExit(
	frame: number,
	enterStart: number,
	enterEnd: number,
	holdEnd: number,
	exitEnd: number,
): number {
	if (frame < enterStart) {
		return 0;
	}
	if (frame < enterEnd) {
		return soft((frame - enterStart) / (enterEnd - enterStart));
	}
	if (frame < holdEnd) {
		return 1;
	}
	if (frame < exitEnd) {
		return soft((exitEnd - frame) / (exitEnd - holdEnd));
	}
	return 0;
}

export function float(frame: number, speed: number, amplitude: number): number {
	return Math.sin(frame / speed) * amplitude;
}

export function parallax(frame: number, speed: number, amplitude: number): number {
	return Math.sin(frame / speed) * amplitude;
}

export function continuousZoom(
	frame: number,
	startZoom: number,
	endZoom: number,
	duration: number,
): number {
	return startZoom + (endZoom - startZoom) * (frame / duration);
}
