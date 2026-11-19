export type AuditResult = {
  outcome: "pass" | "fail"
  findings: { severity: "info" | "warning" | "error"; file?: string; line?: number; message: string; recommendation?: string }[]
}
