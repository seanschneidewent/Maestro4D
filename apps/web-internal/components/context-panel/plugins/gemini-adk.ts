import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMPlugin, LLMPluginConfig, GenerationContext, EditRequest, EditResponse, RetrievalRequest, RetrievalResponse } from './types';

export class GeminiADKPlugin implements LLMPlugin {
  name = 'gemini-adk';
  private client: GoogleGenerativeAI | null = null;
  private modelName: string = 'gemini-1.5-flash';
  
  async initialize(config: LLMPluginConfig): Promise<void> {
    const apiKey = config.apiKey || import.meta.env.VITE_GEMINI_API_KEY || ''; // Use VITE_ env var
    // Fallback to empty string to avoid crash, but methods will fail if no key
    if (!apiKey) console.warn("Gemini Plugin: No API Key found");
    
    this.client = new GoogleGenerativeAI(apiKey);
    if (config.model) this.modelName = config.model;
  }
  
  isReady(): boolean {
    return this.client !== null;
  }
  
  async generateContext(context: GenerationContext): Promise<string> {
    if (!this.client) throw new Error('Plugin not initialized');
    
    const model = this.client.getGenerativeModel({ model: this.modelName });
    const prompt = this.buildGenerationPrompt(context);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    return response.text();
  }
  
  async editMarkdown(request: EditRequest): Promise<EditResponse> {
    if (!this.client) throw new Error('Plugin not initialized');
    
    const model = this.client.getGenerativeModel({ model: this.modelName });
    const prompt = `You are editing a markdown document for a construction site analysis system.

Current document:
\`\`\`markdown
${request.currentMarkdown}
\`\`\`

User instruction: "${request.userInstruction}"

Respond with ONLY the updated markdown. Do not include explanation or code fences.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    // Strip code fences if present
    text = text.replace(/^```markdown\n/, '').replace(/^```\n/, '').replace(/\n```$/, '');

    return {
      newMarkdown: text || request.currentMarkdown,
    };
  }
  
  async retrieveRelevant(request: RetrievalRequest): Promise<RetrievalResponse> {
    if (!this.client) throw new Error('Plugin not initialized');
    
    // JSON mode is supported in newer models, explicitly requested in prompt as well
    const model = this.client.getGenerativeModel({ 
        model: this.modelName, 
        generationConfig: { responseMimeType: "application/json" } 
    });

    const nodeDescriptions = request.availableNodes.map(n => 
      `- ID: ${n.id}, Name: ${n.name}, Path: ${n.path}, Summary: ${n.summary || 'N/A'}`
    ).join('\n');
    
    const prompt = `You are a retrieval system for construction site documentation.

User query: "${request.query}"

Available documents:
${nodeDescriptions}

Return a JSON array of the most relevant documents for this query. Format:
[
  {"nodeId": "...", "relevance": "high|medium|low|summary", "reason": "brief explanation", "score": 0.0-1.0}
]

Return at most ${request.maxResults || 5} results. Only include genuinely relevant documents.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    try {
      const parsed = JSON.parse(response.text());
      return { rankedResults: parsed };
    } catch (e) {
      console.error("Failed to parse retrieval response", e);
      return { rankedResults: [] };
    }
  }
  
  private buildGenerationPrompt(context: GenerationContext): string {
    if (context.nodeType === 'file') {
      return `Generate a markdown documentation file for a construction point cloud scan.

File: ${context.nodeName}
Path: ${context.nodePath}

Analysis Results:
${JSON.stringify(context.analysisResults, null, 2)}

Metadata:
${JSON.stringify(context.metadata, null, 2)}

Generate markdown with these sections:
1. # [filename] - Title
2. ## Metadata - Capture date, location, point count, file size
3. ## Analysis Results - Line detection findings, measurements
4. ## Issues Flagged - Table of any issues with Element, Issue, Measured, Spec, Deviation columns
5. ## Plan Compliance - Checklist of what passes/fails spec
6. ## LLM Context Block - HTML comment with structured fields: LOCATION, PHASE, SCAN_DATE, STATUS, KEYWORDS, SUMMARY

Be concise and factual. Use tables for issues. Use ✅/❌ for compliance items.`;
    } else {
      return `Generate a folder-level summary markdown for a construction project phase.

Folder: ${context.nodeName}
Path: ${context.nodePath}

Child documents:
${context.childContexts?.join('\n\n---\n\n') || 'No children yet'}

Generate markdown with these sections:
1. # [folder name] - Title
2. ## Overview - Scan count, date range, overall status
3. ## Contents - Table with File, Status, Key Finding columns
4. ## Aggregated Issues - Numbered list of all issues from children
5. ## Phase Summary - 2-3 sentence summary of phase status

Synthesize information from child documents. Highlight critical issues.`;
    }
  }
}

export const geminiPlugin = new GeminiADKPlugin();

