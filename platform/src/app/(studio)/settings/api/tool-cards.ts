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
  { name: "list_presets", text: "The presets with the price of one run. One photo, one finished clip.", effect: "read" },
  { name: "run_preset", text: "Starts a preset with the photo and the consent of the people shown.", effect: "spend" },
  { name: "list_marketing_styles", text: "The Marketing Agent's styles with what they need, their formats and the price of one run.", effect: "read" },
  { name: "run_marketing_style", text: "Turns a product photo into UGC, product shots, motion, ads, posters or shop images.", effect: "spend" },
  { name: "continue_marketing_ugc", text: "UGC step 2: the finished still speaks. Included in the price of step 1.", effect: "spend" },
  { name: "ask_director", text: "The Director turns a wish into two or three priced proposals. Starts nothing.", effect: "plan" },
  { name: "ask_marketing_agent", text: "The Marketing Agent plans up to four creatives with caption and price from a brief. Starts nothing.", effect: "plan" },
  { name: "list_director_models", text: "The Director's language models and what a message costs today.", effect: "read" },
];

export const EFFECT_LABEL: Record<ToolEffect, string> = { read: "reads", spend: "spends Credits", upload: "uploads", plan: "plans", share: "shares" };
