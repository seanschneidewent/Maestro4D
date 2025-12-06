import type { LLMPlugin, LLMPluginConfig, GenerationContext, EditRequest, EditResponse, RetrievalRequest, RetrievalResponse } from './types';

export class OpenAIPlugin implements LLMPlugin {
  name = 'openai';
  
  async initialize(config: LLMPluginConfig): Promise<void> {
    console.log('OpenAI initialized (stub)');
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

