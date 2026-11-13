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

  it("uses the inverse logo for a dark document background", async () => {
    const mock = storageClient({ data: { signedUrl: "https://signed.example/inverse.png" }, error: null });
    const url = await resolveOrganizationLogoUrl(mock.client, {
      logo_storage_path:"org-1/color.png",
      logo_inverse_storage_path:"org-1/inverse.png",
      document_theme:{ backgroundColor:"#13243A" },
    });
    expect(url).toBe("https://signed.example/inverse.png");
    expect(mock.createSignedUrl).toHaveBeenCalledWith("org-1/inverse.png",3600);
  });
  it("keeps the colour logo on a light background", async () => {
    const mock = storageClient({data:{signedUrl:"https://signed.example/color.png"},error:null});
    await resolveOrganizationLogoUrl(mock.client,{
      logo_storage_path:"org-1/color.png",
      logo_inverse_storage_path:"org-1/inverse.png",
      document_theme:{ backgroundColor:"#FFFFFF" },
    });
    expect(mock.createSignedUrl).toHaveBeenCalledWith("org-1/color.png",3600);
  });

  it("keeps a finalized light-theme snapshot when current company uses a dark theme", async () => {
    const mock=storageClient({data:{signedUrl:"https://signed.example/issued.png"},error:null});
    await resolveOrganizationLogoUrl(mock.client,
      {logo_storage_path:"org-1/issued.png",logo_inverse_storage_path:"org-1/issued-inverse.png",
        document_theme:{backgroundColor:"#FFFFFF"}},
      {logo_storage_path:"org-1/latest.png",logo_inverse_storage_path:"org-1/latest-inverse.png",
        document_theme:{backgroundColor:"#102030"}}
    );
    expect(mock.createSignedUrl).toHaveBeenCalledWith("org-1/issued.png",3600);
  });
  it("returns null when no usable logo exists", async () => {
    const mock = storageClient({ data: null, error: null });
    await expect(resolveOrganizationLogoUrl(mock.client, { logo_url: null, logo_storage_path: null })).resolves.toBeNull();
  });
});
