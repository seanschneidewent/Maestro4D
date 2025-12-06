import type { LLMPlugin, LLMPluginConfig, GenerationContext, EditRequest, EditResponse, RetrievalRequest, RetrievalResponse } from './types';

export class AnthropicPlugin implements LLMPlugin {
  name = 'anthropic';
  
  async initialize(config: LLMPluginConfig): Promise<void> {
    console.log('Anthropic initialized (stub)');
  }
  
  isReady(): boolean {
    return false;
  }
  
  async generateContext(context: GenerationContext): Promise<string> {
    throw new Error('Not implemented');
  }
  
  async editMarkdown(request: EditRequest): Promise<EditResponse> {
    throw new Error('Not implemented');
  }
  
  async retrieveRelevant(request: RetrievalRequest): Promise<RetrievalResponse> {
    throw new Error('Not implemented');
  }
}

