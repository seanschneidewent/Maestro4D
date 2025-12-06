export interface LLMPluginConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AnalysisResults {
  // Define based on available data, generic for now
  [key: string]: any;
}

export interface GenerationContext {
  nodeType: 'file' | 'folder';
  nodeName: string;
  nodePath: string;
  analysisResults?: AnalysisResults;
  childContexts?: string[];  // For folders: child markdown contents
  metadata?: Record<string, any>;
}

export interface EditRequest {
  currentMarkdown: string;
  userInstruction: string;
  context?: GenerationContext;
}

export interface EditResponse {
  newMarkdown: string;
  diff?: any[]; // diff result type
}

export interface ContextNode {
  id: string;
  name: string;
  path: string;
  summary?: string;
}

export interface RetrievalRequest {
  query: string;
  availableNodes: ContextNode[];
  maxResults?: number;
}

export interface RetrievalResponse {
  rankedResults: Array<{
    nodeId: string;
    relevance: 'high' | 'medium' | 'low' | 'summary';
    reason: string;
    score: number;
  }>;
}

export interface LLMPlugin {
  name: string;
  
  // Initialize the plugin with config
  initialize(config: LLMPluginConfig): Promise<void>;
  
  // Generate markdown context for a node
  generateContext(context: GenerationContext): Promise<string>;
  
  // Edit existing markdown based on user instruction
  editMarkdown(request: EditRequest): Promise<EditResponse>;
  
  // Rank/retrieve relevant nodes for a query
  retrieveRelevant(request: RetrievalRequest): Promise<RetrievalResponse>;
  
  // Check if plugin is ready
  isReady(): boolean;
}

