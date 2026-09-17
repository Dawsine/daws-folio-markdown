export const DOUBLE_STRUCK_DIGITS: Record<string, string> = {
	'0': '𝟘',
	'1': '𝟙',
	'2': '𝟚',
	'3': '𝟛',
	'4': '𝟜',
	'5': '𝟝',
	'6': '𝟞',
	'7': '𝟟',
	'8': '𝟠',
	'9': '𝟡',
};

type KatexToken = { text: string };
type KatexMacroContext = { consumeArgs: (n: number) => KatexToken[][] };

export function asStringMacroMap(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string' && key) {
			out[key] = value;
		}
	}
	return out;
}

export function expandMathdsArg(arg: string): string {
	const text = String(arg ?? '').replace(/^\{|\}$/g, '');
	if (Object.prototype.hasOwnProperty.call(DOUBLE_STRUCK_DIGITS, text)) {
		return DOUBLE_STRUCK_DIGITS[text];
	}
	return `\\mathbb{${text}}`;
}

export function mathdsKatexMacro(context: KatexMacroContext): string {
	const tokens = context.consumeArgs(1)[0] ?? [];
	return expandMathdsArg(tokens.map((token) => token.text).join(''));
}

export function builtinKatexMacros(): Record<string, typeof mathdsKatexMacro> {
	return {
		'\\mathds': mathdsKatexMacro,
		'\\mathbbm': mathdsKatexMacro,
	};
}
