import { useState } from 'react';
import { getActivePlugin } from '../plugins';
import { getDb } from '../utils/db';

export interface UseRetrievalReturn {
    isSearching: boolean;
    results: any[];
    error: string | null;
    search: (query: string) => Promise<void>;
    clearResults: () => void;
}

export const useRetrieval = (): UseRetrievalReturn => {
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<any[]>([]); 
    const [error, setError] = useState<string|null>(null);

    const search = async (query: string) => {
        setIsSearching(true);
        setError(null);
        try {
            const db = getDb();
            // Get all generated nodes
            const stmt = db.prepare(`
                SELECT n.id, n.name, n.path, c.summary 
                FROM nodes n 
                JOIN context c ON n.id = c.node_id 
                WHERE c.status = 'generated'
            `);
            const availableNodes: any[] = [];
            while(stmt.step()) {
                const row = stmt.getAsObject();
                availableNodes.push(row);
            }
            stmt.free();

            const plugin = getActivePlugin();
            const response = await plugin.retrieveRelevant({
                query,
                availableNodes,
                maxResults: 5
            });
            
            setResults(response.rankedResults);

        } catch (err: any) {
            console.error(err);
            setError(err.message || "Retrieval failed");
        } finally {
            setIsSearching(false);
        }
    };
    
    const clearResults = () => setResults([]);
    
    return { isSearching, results, error, search, clearResults };
}

