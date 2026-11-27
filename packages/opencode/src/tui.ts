import { Plugin } from "@opencode/plugin/tui"
import type { GoatConfig } from "@goat/core"
import { Goat } from "@goat/opencode/rpc"

export default Plugin.define({
  id: "goat.model-router.tui",
  setup(context) {
    const goat = context.client.rpc(Goat)
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "goat.model-router.menu",
        title: "GOAT Model Router",
        group: "GOAT",
        palette: true,
        slash: { name: "goat", arguments: true },
        run: async (input) => {
          const location = { location: context.location ?? { directory: process.cwd() } }
          try {
              const { config } = await goat.getConfig({}, location) as { config: GoatConfig }
            const [verb, ...args] = (input ?? "status").trim().split(/\s+/)
            if (verb === "on" || verb === "off") {
              const { text } = await goat.command({ input: verb }, location) as { text: string }
              await context.ui.dialog.alert({ title: `GOAT ${verb}`, message: text })
              return
            }
            if (verb === "mode") {
              const requested = args[0]
              const mode = requested === "standard" || requested === "resink"
                ? requested
                : await context.ui.dialog.select({ title: "GOAT mode", current: config.mode, options: [
                    { title: "Standard", value: "standard", description: "Manager Task Planner disabled" },
                    { title: "Resink", value: "resink", description: "Manager Task Planner enabled for decision requests" },
                  ] })
              if (mode) await goat.setConfig({ config: { ...config, mode } }, location)
              return
            }
            if (verb === "router") {
              if (args.length > 0) { await context.ui.dialog.alert({ title: "GOAT router", message: "Use the interactive model picker; CLI model IDs are not accepted." }); return }
              const { models } = await goat.listModels({}, location) as { models: { providerID: string; modelID: string; name: string; providerName: string }[] }
              const next = structuredClone(config)
              const roles = ["manager", "l1", "l2", "l3", "auditor"] as const
              for (const role of roles) {
                const choice = role === "manager" ? await context.ui.dialog.select({ title: "Manager model", options: [
                  { title: "Inherit current session model", value: "inherit" },
                  { title: "Select explicit model", value: "select" },
                  { title: "Cancel", value: "cancel" },
                ] }) : "select"
                if (!choice || choice === "cancel") return
                const inherit = choice === "inherit"
                if (inherit) { next.inheritManagerModel = true; delete next.models.manager; continue }
                if (!models.length) { await context.ui.dialog.alert({ title: `Select ${role}`, message: "No configured provider models are available. Nothing saved." }); return }
                const current = next.models[role]
                const selected = await context.ui.dialog.select({
                  title: `Select ${role}`,
                  current: current ? `${current.providerID}\0${current.modelID}` : undefined,
                  options: models.map((model) => ({ title: `${model.providerName} / ${model.name}`, description: `${model.providerID}/${model.modelID}`, value: `${model.providerID}\0${model.modelID}` })),
                })
                if (!selected) return
                const [providerID, modelID] = selected.split("\0")
                next.models[role] = { providerID, modelID }
                if (role === "manager") next.inheritManagerModel = false
              }
              await goat.setConfig({ config: next }, location)
              await context.ui.dialog.alert({ title: "GOAT router", message: "Model assignments saved." })
              return
            }
            if (verb === "status") {
              const { text } = await goat.command({ input: "status" }, location) as { text: string }
              await context.ui.dialog.alert({ title: "GOAT status", message: text })
              return
            }
            await context.ui.dialog.alert({ title: "GOAT", message: "Usage: /goat router|mode|on|off|status" })
          } catch (error) {
            await context.ui.dialog.alert({ title: "GOAT RPC unavailable", message: describeError(error) })
          }
        },
      }],
    }))
  },
})

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    const record = error as { type?: unknown; message?: unknown; cause?: unknown }
    if (typeof record.message === "string") return typeof record.type === "string" ? `${record.type}: ${record.message}` : record.message
    if (record.cause) return describeError(record.cause)
    try { return JSON.stringify(error) } catch { return String(error) }
  }
  return String(error)
}
