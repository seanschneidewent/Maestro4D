import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Base directories for n8n data
const N8N_DATA_DIR = path.join(__dirname, '..', 'n8n_data');
const WATCH_INBOX_DIR = path.join(N8N_DATA_DIR, 'watch_inbox');
const PROCESSED_DIR = path.join(N8N_DATA_DIR, 'processed');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure directories exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(WATCH_INBOX_DIR);
ensureDir(PROCESSED_DIR);

/**
 * POST /api/export-batch
 * Receives batch data from frontend, writes to n8n_data/watch_inbox/{batchId}/
 */
app.post('/api/export-batch', async (req, res) => {
  try {
    const { batchId, sheets } = req.body;

    if (!batchId || !sheets || !Array.isArray(sheets)) {
      return res.status(400).json({ error: 'Invalid payload: batchId and sheets array required' });
    }

    const batchDir = path.join(WATCH_INBOX_DIR, batchId);
    ensureDir(batchDir);

    // Process each sheet
    for (const sheet of sheets) {
      const { sheetId, fileName, pointers } = sheet;
      
      if (!sheetId || !pointers || !Array.isArray(pointers)) {
        continue;
      }

      const sheetDir = path.join(batchDir, sheetId);
      ensureDir(sheetDir);

      // Process each pointer
      for (const pointer of pointers) {
        const { id, imageBase64, metadata } = pointer;
        
        if (!id) continue;

        const pointerDir = path.join(sheetDir, id);
        ensureDir(pointerDir);

        // Write image if provided
        if (imageBase64) {
          const imageBuffer = Buffer.from(imageBase64, 'base64');
          fs.writeFileSync(path.join(pointerDir, 'image.png'), imageBuffer);
        }

        // Write metadata
        const metadataToWrite = {
          id,
          title: metadata?.title || '',
          description: metadata?.description || '',
          pageNumber: metadata?.pageNumber || 0,
          boundingBox: metadata?.boundingBox || null,
          sourceFile: fileName
        };
        fs.writeFileSync(
          path.join(pointerDir, 'metadata.json'),
          JSON.stringify(metadataToWrite, null, 2)
        );
      }
    }

    // Write manifest.json last (signals batch is complete)
    const manifest = {
      batchId,
      exportedAt: new Date().toISOString(),
      sheets: sheets.map(sheet => ({
        sheetId: sheet.sheetId,
        fileName: sheet.fileName,
        pointerIds: sheet.pointers.map(p => p.id)
      }))
    };

    fs.writeFileSync(
      path.join(batchDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    res.json({
      success: true,
      batchId,
      message: `Batch exported successfully with ${sheets.length} sheets`,
      path: batchDir
    });

  } catch (error) {
    console.error('Error exporting batch:', error);
    res.status(500).json({ error: 'Failed to export batch', details: error.message });
  }
});

/**
 * GET /api/processed-batches
 * Lists all folders in n8n_data/processed/
 */
app.get('/api/processed-batches', (req, res) => {
  try {
    if (!fs.existsSync(PROCESSED_DIR)) {
      return res.json({ batches: [] });
    }

    const entries = fs.readdirSync(PROCESSED_DIR, { withFileTypes: true });
    const batches = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const batchDir = path.join(PROCESSED_DIR, entry.name);
        const resultsPath = path.join(batchDir, 'results.json');

        let batchInfo = {
          batchId: entry.name,
          hasResults: false,
          processedAt: null,
          sheetCount: 0,
          pointerCount: 0
        };

        if (fs.existsSync(resultsPath)) {
          try {
            const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
            batchInfo.hasResults = true;
            batchInfo.processedAt = results.processedAt || null;
            batchInfo.sheetCount = results.sheets?.length || 0;
            batchInfo.pointerCount = results.sheets?.reduce(
              (sum, sheet) => sum + (sheet.pointers?.length || 0), 0
            ) || 0;
          } catch (e) {
            // Results file exists but couldn't be parsed
            console.error(`Error reading results for batch ${entry.name}:`, e);
          }
        }

        batches.push(batchInfo);
      }
    }

    // Sort by processedAt descending (newest first)
    batches.sort((a, b) => {
      if (!a.processedAt) return 1;
      if (!b.processedAt) return -1;
      return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
    });

    res.json({ batches });

  } catch (error) {
    console.error('Error listing processed batches:', error);
    res.status(500).json({ error: 'Failed to list processed batches', details: error.message });
  }
});

/**
 * GET /api/processed/:batchId
 * Returns the results.json from a specific processed batch
 */
app.get('/api/processed/:batchId', (req, res) => {
  try {
    const { batchId } = req.params;
    const resultsPath = path.join(PROCESSED_DIR, batchId, 'results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.status(404).json({ error: 'Batch not found or not yet processed' });
    }

    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    res.json(results);

  } catch (error) {
    console.error('Error fetching batch results:', error);
    res.status(500).json({ error: 'Failed to fetch batch results', details: error.message });
  }
});

/**
 * DELETE /api/processed/:batchId
 * Removes a processed batch after commit
 */
app.delete('/api/processed/:batchId', (req, res) => {
  try {
    const { batchId } = req.params;
    const batchDir = path.join(PROCESSED_DIR, batchId);

    if (!fs.existsSync(batchDir)) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Recursively delete the batch directory
    fs.rmSync(batchDir, { recursive: true, force: true });

    res.json({ success: true, message: `Batch ${batchId} deleted successfully` });

  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({ error: 'Failed to delete batch', details: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`n8n Export API server running on http://localhost:${PORT}`);
  console.log(`Watch inbox: ${WATCH_INBOX_DIR}`);
  console.log(`Processed dir: ${PROCESSED_DIR}`);
});

