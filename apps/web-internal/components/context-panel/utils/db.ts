import initSqlJs, { Database } from 'sql.js';

export interface ContextNode {
  id: string;
  parentId: string | null;
  name: string;
  type: 'file' | 'folder';
  path: string;
  createdAt: string;
}

export interface ContextDocument {
  id: string;
  nodeId: string;
  markdown: string;
  generatedAt: string;
  status: 'pending' | 'generated' | 'stale';
  summary?: string;
  keywords?: string;
}

export interface Issue {
  id: string;
  nodeId: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  description: string;
  locationKeywords: string;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES nodes(id),
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('file', 'folder')),
  path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id) UNIQUE,
  markdown TEXT,
  generated_at DATETIME,
  status TEXT CHECK(status IN ('pending', 'generated', 'stale')) DEFAULT 'pending',
  summary TEXT,
  keywords TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id),
  severity TEXT CHECK(severity IN ('info', 'warning', 'critical')),
  category TEXT,
  description TEXT,
  location_keywords TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_context_node ON context(node_id);
CREATE INDEX IF NOT EXISTS idx_context_status ON context(status);
CREATE INDEX IF NOT EXISTS idx_issues_node ON issues(node_id);
CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
`;

let dbInstance: Database | null = null;

export const initDb = async (): Promise<Database> => {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs({
    locateFile: file => `https://sql.js.org/dist/${file}`
  });

  dbInstance = new SQL.Database();
  dbInstance.run(SCHEMA);
  return dbInstance;
};

export const getDb = (): Database => {
  if (!dbInstance) throw new Error("DB not initialized");
  return dbInstance;
};

