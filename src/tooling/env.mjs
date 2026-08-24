import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

export function parseEnvFile(data) {
    return `${data ?? ''}`.split('\n').flatMap(line => {
        const trimmed = line.trim();
        const separator = trimmed.indexOf('=');
        if (!trimmed || trimmed.startsWith('#') || separator <= 0) return [];
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
        return key ? [[key, value]] : [];
    });
}

/**
 * Loads a project-root `.env` file (if present) into `process.env`. Silently
 * does nothing when no `.env` file exists.
 */
export async function loadEnvFile() {
    try {
        const filePath = resolve(join('./.env'));
        const data = await readFile(filePath, 'utf-8');
        for (const [key, value] of parseEnvFile(data)) process.env[key] = value;
    } catch (err) {
    }
}
