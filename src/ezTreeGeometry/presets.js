import TreeOptions from './options.js';

// The game authors every tree option directly and never loads library presets.
// Retain the generator's method contract without bundling unused preset JSON.
export function loadPreset() { return new TreeOptions(); }
