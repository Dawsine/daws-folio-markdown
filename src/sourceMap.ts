export interface SourceBlock {
	start: number;
	end: number;
}

function isBlank(line: string): boolean {
	return /^\s*$/.test(line);
}

export function mapMarkdownBlocks(markdown: string): SourceBlock[] {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const blocks: SourceBlock[] = [];
	let i = 0;
	const n = lines.length;

	while (i < n) {
		if (isBlank(lines[i])) {
			i += 1;
			continue;
		}

		const start = i;
		const line = lines[i];

		if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) {
			blocks.push({ start, end: i + 1 });
			i += 1;
			continue;
		}

		const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line);
		if (fence) {
			const mark = fence[2][0] === '`' ? '`' : '~';
			const len = fence[2].length;
			const close = new RegExp(`^ {0,3}${mark}{${len},}\\s*$`);
			i += 1;
			while (i < n && !close.test(lines[i])) {
				i += 1;
			}
			if (i < n) {
				i += 1;
			}
			blocks.push({ start, end: i });
			continue;
		}

		const trimmed = line.trim();
		if (trimmed.startsWith('$$')) {
			const count = trimmed.match(/\$\$/g)?.length ?? 0;
			if (count >= 2 && trimmed !== '$$') {
				blocks.push({ start, end: i + 1 });
				i += 1;
				continue;
			}
			i += 1;
			while (i < n && !lines[i].includes('$$')) {
				i += 1;
			}
			if (i < n) {
				i += 1;
			}
			blocks.push({ start, end: i });
			continue;
		}

		if (
			/^ {0,3}\|/.test(line) ||
			(/\|/.test(line) && i + 1 < n && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]))
		) {
			while (i < n && /\|/.test(lines[i]) && !isBlank(lines[i])) {
				i += 1;
			}
			blocks.push({ start, end: i });
			continue;
		}

		i += 1;
		while (i < n && !isBlank(lines[i])) {
			const next = lines[i];
			if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(next)) {
				break;
			}
			if (/^( {0,3})(`{3,}|~{3,})/.test(next)) {
				break;
			}
			if (next.trim().startsWith('$$')) {
				break;
			}
			i += 1;
		}
		blocks.push({ start, end: i });
	}

	return blocks;
}

export function blockIndexForLine(blocks: SourceBlock[], line: number): number {
	let found = 0;
	for (let i = 0; i < blocks.length; i++) {
		if (blocks[i].start <= line) {
			found = i;
		}
		if (blocks[i].start > line) {
			break;
		}
	}
	return found;
}
