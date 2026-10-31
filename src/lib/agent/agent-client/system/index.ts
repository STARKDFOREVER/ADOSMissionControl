/**
 * @module agent/agent-client/system
 * @description Status / telemetry / services / system / logs / params
 * / generic command surface. Pure async functions that take a request
 * context; the AgentClient class re-exposes them as instance methods.
 * @license GPL-3.0-only
 */

export {
  normaliseSystemResources,
  getStatus,
  getServices,
  getSystemResources,
  getLogs,
} from "./resources";
export {
  AGENT_COMMAND_NAMES,
  type AgentCommandName,
  type AgentCommandOutcome,
  decodeAgentCommandOutcome,
  runCommand,
  sendCommand,
} from "./commands";
export {
  getConfig,
  setConfigValue,
  type ServiceRestartResult,
  type SupervisorRestartResult,
  SERVICE_RESTART_TIMEOUT_MS,
  restartService,
  restartSupervisor,
} from "./config";
export {
  normalizeFullStatusLiveness,
  getFullStatus,
} from "./full-status";
export {
  getMavlinkPorts,
  setMavlinkSource,
  pingAgent,
} from "./mavlink";
