/**
 * The MCP tools as the "API & MCP" console shows them: one line each, and whether a call only reads, spends credits,
 * brings in a file, plans (the Director: free within a daily budget, credits only with the strongest models) or shares a
 * result in the community.
 * src/server/mcp.test.ts keeps this list equal to the tools the server registers.
 */
export type ToolEffect = "read" | "spend" | "upload" | "plan" | "share";

export const TOOL_CARDS: { name: string; text: string; effect: ToolEffect }[] = [
  { name: "list_models", text: "Every image and video model with parameters, starting price and lifecycle.", effect: "read" },
  { name: "get_price", text: "The price in Credits before anything starts. Free.", effect: "read" },
  { name: "generate", text: "Starts an image or video with a price cap. Credits back on failure.", effect: "spend" },
  { name: "get_job", text: "Status and result of a job; can wait until it is done.", effect: "read" },
  { name: "list_jobs", text: "The account's latest jobs with status and result links.", effect: "read" },
  { name: "get_account", text: "The signed-in account and its Credits balance.", effect: "read" },
  { name: "get_credits", text: "Available, reserved, spent, plus the latest transactions.", effect: "read" },
  { name: "set_visibility", text: "Shares a finished result in the Community or makes it private again. Only on request.", effect: "share" },
  { name: "create_upload", text: "A signed address to upload your own start image.", effect: "upload" },
  { name: "import_image", text: "Fetches a public image from the web as a start image.", effect: "upload" },
  { name: "reuse_result", text: "Turns one of your finished results into an upload for a reference or start image.", effect: "upload" },
  { name: "request_consent", text: "Jobs with real people: asks for your confirmation in the studio before starting.", effect: "plan" },
  { name: "ask_director", text: "The Director turns a wish into two or three priced proposals. Starts nothing.", effect: "plan" },
  { name: "list_director_models", text: "The Director's language models and what a message costs today.", effect: "read" },
];

export const EFFECT_LABEL: Record<ToolEffect, string> = { read: "reads", spend: "spends Credits", upload: "uploads", plan: "plans", share: "shares" };
