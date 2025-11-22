// This file is used to provide TypeScript type definitions for modules
// that are not explicitly typed or are loaded in a non-standard way,
// such as via a CDN and import maps.

/**
 * Adds module declarations for React packages loaded from a CDN.
 * This resolves "Could not find a declaration file for module..." errors (TS7016)
 * for 'react', 'react-dom/client', and 'react/jsx-runtime'.
 */
// FIX: Removed empty module declarations for React packages. These were preventing
// TypeScript from finding any exported members (like FC, useState, etc.), causing
// numerous type errors. This change allows TypeScript to correctly resolve types
// from the installed @types/react and @types/react-dom packages.

/**
 * Provides type definitions for `process.env.API_KEY`.
 * The application's environment is expected to provide this variable.
 * Augmenting the NodeJS.ProcessEnv interface is the standard way to
 * add types for environment variables when using @types/node.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly API_KEY: string;
  }
}
