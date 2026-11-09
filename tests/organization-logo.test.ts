import { describe, expect, it, vi } from "vitest";
import { resolveOrganizationLogoUrl } from "../src/lib/storage/organization-logo";

function storageClient(result: { data: { signedUrl: string } | null; error: unknown }) {
  const createSignedUrl = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ createSignedUrl }));
  return { client: { storage: { from } }, from, createSignedUrl };
}

describe("resolveOrganizationLogoUrl", () => {
  it("re-signs a legacy public URL from the private branding bucket", async () => {
    const mock = storageClient({ data: { signedUrl: "https://signed.example/logo.png" }, error: null });
    const url = await resolveOrganizationLogoUrl(
      mock.client,
      { logo_url: "https://project.supabase.co/storage/v1/object/public/organization-branding/org-1/logo.png?download=1" },
    );
    expect(url).toBe("https://signed.example/logo.png");
    expect(mock.from).toHaveBeenCalledWith("organization-branding");
    expect(mock.createSignedUrl).toHaveBeenCalledWith("org-1/logo.png", 3600);
  });

  it("prefers the persisted storage path over the legacy URL", async () => {
    const mock = storageClient({ data: { signedUrl: "https://signed.example/current.png" }, error: null });
    const url = await resolveOrganizationLogoUrl(
      mock.client,
      { logo_url: "https://external.example/old.png", logo_storage_path: "org-1/current.png" },
    );
    expect(url).toBe("https://signed.example/current.png");
    expect(mock.createSignedUrl).toHaveBeenCalledWith("org-1/current.png", 3600);
  });

  it("falls back to the next captured/current source when an old object is missing", async () => {
    const createSignedUrl = vi.fn()
      .mockResolvedValueOnce({ data: null, error: new Error("Object not found") })
      .mockResolvedValueOnce({ data: { signedUrl: "https://signed.example/current.png" }, error: null });
    const client = { storage: { from: vi.fn(() => ({ createSignedUrl })) } };
    const url = await resolveOrganizationLogoUrl(
      client,
      { logo_url: "https://project.supabase.co/storage/v1/object/public/organization-branding/org-1/deleted.png" },
      { logo_storage_path: "org-1/current.png" },
    );
    expect(url).toBe("https://signed.example/current.png");
  });

  it("keeps external logo URLs unchanged", async () => {
    const mock = storageClient({ data: null, error: null });
    const url = await resolveOrganizationLogoUrl(mock.client, { logo_url: "https://cdn.example/logo.png" });
    expect(url).toBe("https://cdn.example/logo.png");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("returns null when no usable logo exists", async () => {
    const mock = storageClient({ data: null, error: null });
    await expect(resolveOrganizationLogoUrl(mock.client, { logo_url: null, logo_storage_path: null })).resolves.toBeNull();
  });
});
