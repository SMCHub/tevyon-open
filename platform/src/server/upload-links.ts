import { createUploadLinks, type UploadLinks } from "@/core/upload-links";

let links: UploadLinks | undefined;

/** Signed upload addresses for agents (MCP create_upload). Same secret as the media links, other purpose prefix. */
export function uploadLinks(): UploadLinks {
  const secret = process.env.MEDIA_LINK_SECRET;
  if (!secret) throw new Error("MEDIA_LINK_SECRET is missing (platform/.env.local)");
  return (links ??= createUploadLinks({ secret }));
}
