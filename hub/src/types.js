// hub/src/types.js
//
// Shared JSDoc type definitions. Not imported at runtime.
// Reference with: /** @param {import('./types.js').User} user */

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {"admin"|"user"} role
 * @property {string} passwordHash
 * @property {number} createdAt
 * @property {string} [createdBy]
 */

/**
 * @typedef {Object} ApiToken
 * @property {string} id
 * @property {string} name
 * @property {string} tokenHash
 * @property {"admin"|"user"} role
 * @property {number} createdAt
 * @property {number} [lastUsed]
 */

/**
 * @typedef {Object} AgentConnection
 * @property {import('ws').WebSocket} ws
 * @property {string} hostname
 * @property {Object} lastMetrics
 * @property {Object[]} lastContainers
 * @property {Object[]} discoveredRepos
 * @property {number} connectedAt
 */

/**
 * @typedef {Object} PageEntry
 * @property {string} path
 * @property {string} file
 * @property {string} title
 * @property {boolean} auth
 */

/**
 * @typedef {Object} ServiceEntry
 * @property {string} id
 * @property {string} role
 * @property {string} root
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} name
 * @property {string} header
 * @property {string[]} exports
 * @property {number} size
 * @property {{ hash: string, message: string, date: string }} lastCommit
 */

/**
 * @typedef {Object} ConventionResult
 * @property {"green"|"yellow"|"red"} status
 * @property {Object} checks
 */
