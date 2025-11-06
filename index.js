#!/usr/bin/env node

/**
 * Strmarr - IPTV Playlist STRM syncer for Playarr
 * Main entry point for synchronizing STRM files by fetching JSON mapping from Playarr API
 * and creating/updating STRM files accordingly.
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

// Load .env file if it exists (for local development)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment variables
const MEDIA_PATH = process.env.MEDIA_PATH || '/app/media';
const PLAYARR_BASE_URL = process.env.PLAYARR_BASE_URL;
const PLAYARR_API_KEY = process.env.PLAYARR_API_KEY;
const SYNC_INTERVAL = process.env.SYNC_INTERVAL || '0 * * * *'; // Every hour by default

// Media types to sync
const MEDIA_TYPES = ['movies', 'shows'];

if (!PLAYARR_BASE_URL) {
  console.error('ERROR: PLAYARR_BASE_URL environment variable is required');
  console.error('Expected base URL like: http://localhost:5000');
  process.exit(1);
}

if (!PLAYARR_API_KEY) {
  console.error('ERROR: PLAYARR_API_KEY environment variable is required');
  process.exit(1);
}

/**
 * Fetch JSON mapping from URL
 */
async function fetchMapping(url) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Fetching mapping from ${url}...`);
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      protocol.get(url, (res) => {
        let data = '';

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP error! status: ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            console.log(`Successfully fetched mapping with ${Object.keys(json).length} entries`);
            resolve(json);
          } catch (parseError) {
            reject(new Error(`Failed to parse JSON: ${parseError.message}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });
    } catch (error) {
      reject(new Error(`Invalid URL: ${error.message}`));
    }
  });
}

/**
 * Collect all unique directories from file paths
 * Returns unique immediate parent directories (recursive: true handles creating parents)
 */
function collectAllDirectories(filePaths) {
  const dirSet = new Set();
  
  for (const filePath of filePaths) {
    const fullPath = join(MEDIA_PATH, filePath);
    const parentDir = dirname(fullPath);
    // Only add if it's not the base MEDIA_PATH itself
    if (parentDir !== MEDIA_PATH) {
      dirSet.add(parentDir);
    }
  }
  
  return Array.from(dirSet);
}

/**
 * Create all directories with proper permissions
 */
async function createAllDirectories(directories) {
  console.log(`\nCreating ${directories.length} directories...`);
  let createdCount = 0;
  let existingCount = 0;
  
  for (const dir of directories) {
    try {
      await fs.access(dir);
      existingCount++;
    } catch {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`  Created: ${dir}`);
        createdCount++;
      } catch (error) {
        console.error(`  Failed to create ${dir}:`, error.message);
        // Continue with other directories
      }
    }
  }
  
  console.log(`Directory creation complete: ${createdCount} created, ${existingCount} already existed`);
}

/**
 * Write STRM file with URL content
 * Assumes directory already exists
 * Only overwrites if the URL (including api_key) has changed
 * Returns true if file was updated, false if skipped (no change)
 */
async function writeStrmFile(filePath, url) {
  try {
    const fullPath = join(MEDIA_PATH, filePath);

    // Check if file exists and read current content
    let fileExists = false;
    let existingContent = '';
    try {
      existingContent = await fs.readFile(fullPath, 'utf8');
      fileExists = true;
    } catch {
      // File doesn't exist, will create it
      fileExists = false;
    }

    // Only write if file doesn't exist or URL has changed
    if (!fileExists || existingContent.trim() !== url.trim()) {
      await fs.writeFile(fullPath, url, 'utf8');
      console.log(`Updated STRM file: ${filePath}`);
      return true;
    } else {
      // File exists with same URL, skip update
      return false;
    }
  } catch (error) {
    console.error(`Error writing STRM file ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Synchronize STRM files based on JSON mapping from multiple endpoints
 */
async function synchronize() {
  const startTime = new Date();
  console.log(`\n=== Starting synchronization at ${startTime.toISOString()} ===`);

  try {
    // Normalize base URL (remove trailing slash if present)
    const baseUrl = PLAYARR_BASE_URL.replace(/\/$/, '');

    // Fetch mappings from all media type endpoints
    const allMappings = {};
    let totalFetched = 0;

    for (const mediaType of MEDIA_TYPES) {
      const endpointUrl = `${baseUrl}/api/playlist/${mediaType}/data?api_key=${PLAYARR_API_KEY}`;

      try {
        console.log(`Fetching ${mediaType} data...`);
        const mapping = await fetchMapping(endpointUrl);

        if (mapping && typeof mapping === 'object') {
          const count = Object.keys(mapping).length;
          console.log(`  ✓ ${mediaType}: ${count} entries`);

          // Merge into all mappings (later entries override earlier ones if same file path)
          Object.assign(allMappings, mapping);
          totalFetched += count;
        } else {
          console.warn(`  ⚠ ${mediaType}: Invalid response format`);
        }
      } catch (error) {
        console.error(`  ✗ ${mediaType}: Failed to fetch - ${error.message}`);
        // Continue with other media types even if one fails
      }
    }

    if (Object.keys(allMappings).length === 0) {
      console.warn('No mappings found from any endpoint');
      return;
    }

    console.log(`\nTotal entries fetched: ${totalFetched}`);
    console.log(`Unique file paths: ${Object.keys(allMappings).length}`);

    // Add api_key query parameter to all URLs
    for (const [filePath, url] of Object.entries(allMappings)) {
      if (url && typeof url === 'string') {
        allMappings[filePath] = url;
      }
    }

    // Step 1: Collect all file paths and extract unique directories
    const filePaths = [];
    for (const [filePath, url] of Object.entries(allMappings)) {
      if (!filePath || !url) {
        console.warn(`Skipping invalid entry: ${filePath} -> ${url}`);
        continue;
      }

      // Ensure file path ends with .strm
      const strmPath = filePath.endsWith('.strm') ? filePath : `${filePath}.strm`;
      filePaths.push(strmPath);
    }

    // Step 2: Collect all unique directories and create them upfront
    const allDirectories = collectAllDirectories(filePaths);
    await createAllDirectories(allDirectories);

    // Step 3: Now process all files (directories are guaranteed to exist)
    console.log(`\nWriting ${filePaths.length} STRM files...`);
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const [filePath, url] of Object.entries(allMappings)) {
      if (!filePath || !url) {
        continue; // Already warned above
      }

      // Ensure file path ends with .strm
      const strmPath = filePath.endsWith('.strm') ? filePath : `${filePath}.strm`;

      try {
        const wasUpdated = await writeStrmFile(strmPath, url);
        if (wasUpdated) {
          updatedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        errorCount++;
        console.error(`Failed to process ${strmPath}:`, error.message);
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n=== Synchronization completed ===`);
    console.log(`Duration: ${duration}s`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (no change): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total: ${updatedCount + skippedCount + errorCount}`);

  } catch (error) {
    console.error(`Synchronization failed:`, error.message);
    throw error;
  }
}

/**
 * Start the application
 */
async function start() {
  try {
    console.log('Strmarr starting...');
    console.log(`Media path: ${MEDIA_PATH}`);
    console.log(`Playarr base URL: ${PLAYARR_BASE_URL}`);
    console.log(`Endpoints: ${MEDIA_TYPES.map(type => `/api/playlist/${type}/data`).join(', ')}`);
    console.log(`Sync interval: ${SYNC_INTERVAL} (every hour)`);

    // Verify media directory exists
    try {
      await fs.access(MEDIA_PATH);
      console.log(`Media directory verified: ${MEDIA_PATH}`);
    } catch {
      console.log(`Media directory does not exist, creating: ${MEDIA_PATH}`);
      await fs.mkdir(MEDIA_PATH, { recursive: true });
    }

    // Run synchronization immediately on startup
    await synchronize().catch(error => {
      console.error('Initial synchronization failed:', error.message);
    });

    // Schedule periodic synchronization (every hour)
    cron.schedule(SYNC_INTERVAL, async () => {
      await synchronize().catch(error => {
        console.error('Scheduled synchronization failed:', error.message);
      });
    });

    console.log('Strmarr started. Waiting for scheduled sync...');

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\nShutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down gracefully...');
      process.exit(0);
    });

  } catch (error) {
    console.error('Error starting application:', error);
    process.exit(1);
  }
}

start();
