import { Rpc } from "@opencode/plugin/rpc"

export const Goat = Rpc.define({
  id: "goat.model-router",
  methods: {
    health: {
      input: {
        type: "object",
        properties: { requestID: { type: "string" } },
        required: ["requestID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          pluginID: { type: "string" },
          active: { type: "boolean" },
          handled: { type: "boolean" },
          protocolVersion: { type: "string" },
          requestID: { type: "string" },
        },
        required: ["pluginID", "active", "handled", "protocolVersion", "requestID"],
        additionalProperties: false,
      },
    },
    getConfig: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object", properties: { config: { type: "object", properties: { version: { type: "number" }, enabled: { type: "boolean" }, mode: { type: "string" }, inheritManagerModel: { type: "boolean" }, models: { type: "object" } }, required: ["version", "enabled", "mode", "inheritManagerModel", "models"], additionalProperties: false } }, required: ["config"], additionalProperties: false },
    },
    setConfig: {
      input: { type: "object", properties: { config: { type: "object" } }, required: ["config"], additionalProperties: false },
      output: { type: "object", properties: { config: { type: "object", properties: { version: { type: "number" }, enabled: { type: "boolean" }, mode: { type: "string" }, inheritManagerModel: { type: "boolean" }, models: { type: "object" } }, required: ["version", "enabled", "mode", "inheritManagerModel", "models"], additionalProperties: false } }, required: ["config"], additionalProperties: false },
    },
    listModels: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object", properties: { models: { type: "array", items: { type: "object", properties: { providerID: { type: "string" }, modelID: { type: "string" }, name: { type: "string" }, providerName: { type: "string" } }, required: ["providerID", "modelID", "name", "providerName"], additionalProperties: false } } },
        required: ["models"], additionalProperties: false,
      },
    },
    command: {
      input: { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false },
      output: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    },
    decide: {
      input: { type: "object", properties: { request: { type: "object" } }, required: ["request"], additionalProperties: false },
      output: {
        type: "object",
        properties: {
          status: { type: "string" },
          reason: { type: "string" },
          result: { type: "object" },
        },
        required: ["status", "result"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
