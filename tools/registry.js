import { createTools } from './index.js';

export function createToolRegistry() {
  const tools = createTools();
  return {
    createAgentTools() {
      return tools;
    },
    listToolNames() {
      return tools.map((tool) => tool.name);
    },
  };
}
