import type { LLMPlugin } from './types';
import { geminiPlugin } from './gemini-adk';
import { OpenAIPlugin } from './openai';
import { AnthropicPlugin } from './anthropic';

const plugins: Record<string, LLMPlugin> = {
  'gemini-adk': geminiPlugin,
  'openai': new OpenAIPlugin(),
  'anthropic': new AnthropicPlugin(),
};

let activePlugin: LLMPlugin = geminiPlugin;

export function registerPlugin(plugin: LLMPlugin): void {
  plugins[plugin.name] = plugin;
}

export function setActivePlugin(name: string): void {
  if (!plugins[name]) throw new Error(`Plugin ${name} not found`);
  activePlugin = plugins[name];
}

export function getActivePlugin(): LLMPlugin {
  return activePlugin;
}

export function getPlugin(name: string): LLMPlugin | undefined {
  return plugins[name];
}

export * from './types';

