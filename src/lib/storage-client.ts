import { convertToOptimizedWebP, formatBytes, type OptimizedWebPResult } from "./image-optimizer";

export interface StorageUploadResponse {
  success: boolean;
  fileKey: string;
  url: string;
  originalSize: number;
  compressedSize: number;
  reductionPercentage: number;
  originalName: string;
  optimizedName: string;
  message?: string;
}

/**
 * Optimizes an image to WebP and uploads it directly to ParsPack Object Storage
 */
export async function uploadFileWithWebPOptimization(
  rawFile: File,
  folder = "uploads",
): Promise<StorageUploadResponse> {
  // 1. Convert to high-compression WebP
  let webpResult: OptimizedWebPResult;
  try {
    webpResult = await convertToOptimizedWebP(rawFile);
  } catch (err) {
    console.warn("[uploadFileWithWebPOptimization] WebP conversion fallback:", err);
    // If not an image or canvas fails, wrap raw file
    webpResult = {
      file: rawFile,
      blob: rawFile,
      dataUrl: "",
      originalSize: rawFile.size,
      compressedSize: rawFile.size,
      reductionPercentage: 0,
      width: 0,
      height: 0,
      originalName: rawFile.name,
      optimizedName: rawFile.name,
    };
  }

  // 2. Prepare FormData for server upload
  const formData = new FormData();
  formData.append("file", webpResult.file);
  formData.append("folder", folder);
  formData.append("originalSize", String(webpResult.originalSize));
  formData.append("compressedSize", String(webpResult.compressedSize));

  // Retrieve auth token if present
  let token = "";
  try {
    const raw = localStorage.getItem("terrabar_d1_session");
    if (raw) token = JSON.parse(raw)?.token || "";
  } catch {
    // ignore
  }

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    const errData = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || `خطا در بارگذاری فایل در فضای ذخیره‌سازی (${response.status})`);
  }

  const result = (await response.json()) as StorageUploadResponse;
  return {
    ...result,
    originalSize: webpResult.originalSize,
    compressedSize: webpResult.compressedSize,
    reductionPercentage: webpResult.reductionPercentage,
  };
}

/**
 * Permanently deletes a file from ParsPack Object Storage
 */
export async function deleteFileFromStorage(
  fileKeyOrUrl: string,
): Promise<{ success: boolean; message: string }> {
  // Extract key if a URL was passed
  const key = fileKeyOrUrl.replace(/^\/api\/storage\/file\//, "").replace(/^https?:\/\/[^/]+\/[^/]+\//, "");

  let token = "";
  try {
    const raw = localStorage.getItem("terrabar_d1_session");
    if (raw) token = JSON.parse(raw)?.token || "";
  } catch {
    // ignore
  }

  const response = await fetch("/api/storage/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ key }),
  });

  if (!response.ok) {
    const errData = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || `خطا در حذف فایل از فضای ذخیره‌سازی (${response.status})`);
  }

  return (await response.json()) as { success: boolean; message: string };
}

export { formatBytes };
