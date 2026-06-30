import { basePath } from "./basePath";

export async function uploadImage(file: File): Promise<string> {
  return uploadFile(file);
}

export async function uploadVideo(file: File): Promise<string> {
  return uploadFile(file);
}

async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${basePath}/api/uploads`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Upload failed (${res.status})`);
  }

  const { url } = await res.json();
  return url;
}

export async function uploadImageFromUrl(imageUrl: string): Promise<string> {
  const res = await fetch(`${basePath}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: imageUrl }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Download failed (${res.status})`);
  }

  const { url } = await res.json();
  return url;
}
