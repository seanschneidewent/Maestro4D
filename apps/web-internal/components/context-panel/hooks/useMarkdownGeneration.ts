import { useState } from 'react';
import { getActivePlugin } from '../plugins';
import { getDb } from '../utils/db';

export interface UseMarkdownGenerationReturn {
  isGenerating: boolean;
  generatingNodeId: string | null;
  error: string | null;
  generate: (nodeId: string, analysisResults?: any) => Promise<void>;
  aiEdit: (nodeId: string, instruction: string) => Promise<any>;
  saveMarkdown: (nodeId: string, markdown: string) => Promise<void>;
  getMarkdown: (nodeId: string) => string | null;
}

export const useMarkdownGeneration = (): UseMarkdownGenerationReturn => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingNodeId, setGeneratingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (nodeId: string, analysisResults: any = {}) => {
    setIsGenerating(true);
    setGeneratingNodeId(nodeId);
    setError(null);
    try {
      const db = getDb();
      // Get node details
      const nodeStmt = db.prepare("SELECT * FROM nodes WHERE id = :id");
      const node = nodeStmt.getAsObject({':id': nodeId});
      nodeStmt.free();
      
      if (!node || !node.id) throw new Error("Node not found");

      // Prepare context
      let childContexts: string[] = [];
      if (node.type === 'folder') {
          const childrenStmt = db.prepare("SELECT id FROM nodes WHERE parent_id = :id");
          while(childrenStmt.step()) {
              const row = childrenStmt.get(); 
              const childId = row[0] as string;
              
              const ctxStmt = db.prepare("SELECT markdown FROM context WHERE node_id = :id");
              const ctx = ctxStmt.getAsObject({':id': childId});
              if (ctx.markdown) childContexts.push(ctx.markdown as string);
              ctxStmt.free();
          }
          childrenStmt.free();
      }

      const plugin = getActivePlugin();
      const markdown = await plugin.generateContext({
          nodeType: node.type as 'file' | 'folder',
          nodeName: node.name as string,
          nodePath: node.path as string,
          analysisResults,
          childContexts,
          metadata: { createdAt: node.created_at }
      });

      // Save to DB
      const existingCtxStmt = db.prepare("SELECT id FROM context WHERE node_id = :id");
      const existingCtx = existingCtxStmt.getAsObject({':id': nodeId});
      existingCtxStmt.free();

      if (existingCtx && existingCtx.id) {
          db.run("UPDATE context SET markdown = :markdown, generated_at = CURRENT_TIMESTAMP, status = 'generated' WHERE node_id = :node_id", {
              ':markdown': markdown,
              ':node_id': nodeId
          });
      } else {
          db.run(`INSERT INTO context (id, node_id, markdown, generated_at, status) 
                  VALUES (:id, :node_id, :markdown, CURRENT_TIMESTAMP, 'generated')`, {
              ':id': crypto.randomUUID(),
              ':node_id': nodeId,
              ':markdown': markdown
          });
      }
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Generation failed");
    } finally {
      setIsGenerating(false);
      setGeneratingNodeId(null);
    }
  };

  const getMarkdown = (nodeId: string) => {
      try {
          const db = getDb();
          const stmt = db.prepare("SELECT markdown FROM context WHERE node_id = :id");
          const res = stmt.getAsObject({':id': nodeId});
          stmt.free();
          return res.markdown as string || null;
      } catch (e) {
          return null;
      }
  };

  const saveMarkdown = async (nodeId: string, markdown: string) => {
      const db = getDb();
      const existing = getMarkdown(nodeId);
      
      if (existing !== null) {
        db.run("UPDATE context SET markdown = :md WHERE node_id = :id", {
            ':md': markdown,
            ':id': nodeId
        });
      } else {
         db.run(`INSERT INTO context (id, node_id, markdown, generated_at, status) 
              VALUES (:id, :node_id, :markdown, CURRENT_TIMESTAMP, 'generated')`, {
          ':id': crypto.randomUUID(),
          ':node_id': nodeId,
          ':markdown': markdown
      }); 
      }
  };
  
  const aiEdit = async (nodeId: string, instruction: string) => {
      const currentMarkdown = getMarkdown(nodeId);
      if (!currentMarkdown) throw new Error("No context to edit");
      
      const plugin = getActivePlugin();
      return plugin.editMarkdown({
          currentMarkdown,
          userInstruction: instruction
      });
  };

  return { isGenerating, generatingNodeId, error, generate, getMarkdown, saveMarkdown, aiEdit };
};

