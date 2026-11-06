/**
 * Client-Side Image Optimizer and WebP Converter
 * Automatically converts all images to high-efficiency, low-file-size WebP
 */

export interface OptimizedWebPResult {
  file: File;
  blob: Blob;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  reductionPercentage: number;
  width: number;
  height: number;
  originalName: string;
  optimizedName: string;
}

export interface OptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.0 to 1.0 (recommended: 0.75 - 0.82)
}

/**
 * Formats byte size into human readable string in Persian
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} مگابایت`;
}

/**
 * Converts any image file (JPG, PNG, GIF, BMP, WebP) into an optimized, highly-compressed WebP file
 */
export async function convertToOptimizedWebP(
  input: File | Blob,
  options: OptimizationOptions = {},
): Promise<OptimizedWebPResult> {
  const maxWidth = options.maxWidth || 1600;
  const maxHeight = options.maxHeight || 1600;
  const quality = options.quality ?? 0.78;

  const originalSize = input.size;
  const originalName = input instanceof File ? input.name : "upload.jpg";
  const baseName = originalName.replace(/\.[^.]+$/, "") || "file";
  const optimizedName = `${baseName}.webp`;

  // 1. Load image into Image element or ImageBitmap
  let width = 0;
  let height = 0;
  let sourceElement: CanvasImageSource;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(input);
    width = bitmap.width;
    height = bitmap.height;
    sourceElement = bitmap;
  } else {
    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(input);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error("خطا در بارگذاری تصویر"));
      img.src = objectUrl;
    });
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    sourceElement = img;
  }

  // 2. Calculate optimal scaled dimensions
  let targetWidth = width;
  let targetHeight = height;

  if (targetWidth > maxWidth || targetHeight > maxHeight) {
    const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * ratio));
    targetHeight = Math.max(1, Math.round(targetHeight * ratio));
  }

  // 3. Draw on off-screen Canvas with high-quality smoothing
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("مرورگر از شتاب‌دهنده گرافیکی بوم (Canvas) پشتیبانی نمی‌کند.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);

  // Close bitmap if needed
  if ("close" in sourceElement && typeof sourceElement.close === "function") {
    sourceElement.close();
  }

  // 4. Export to WebP format with strict compression (with fallback for legacy browsers)
  let targetMimeType = "image/webp";
  let blob: Blob;

  try {
    blob = await new Promise<Blob>((resolve, reject) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(
          (b) => {
            if (b) {
              resolve(b);
            } else {
              // Try fallback to image/jpeg if WebP is unsupported by this browser
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob) {
                    targetMimeType = "image/jpeg";
                    resolve(jpegBlob);
                  } else {
                    reject(new Error("خطا در خروجی تصویر"));
                  }
                },
                "image/jpeg",
                quality,
              );
            }
          },
          "image/webp",
          quality,
        );
      } else {
        // Fallback for very old browsers lacking toBlob
        try {
          const dataUrlFallback = canvas.toDataURL("image/webp", quality);
          const parts = dataUrlFallback.split(",");
          const byteString = atob(parts[1] || "");
          const mimeString = (parts[0] || "").split(":")[1]?.split(";")[0] || "image/webp";
          targetMimeType = mimeString;
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          resolve(new Blob([ab], { type: mimeString }));
        } catch {
          reject(new Error("مرورگر از تبدیل تصویر پشتیبانی نمی‌کند"));
        }
      }
    });
  } catch {
    // If all else fails, use original input as Blob
    blob = input;
  }

  const compressedSize = blob.size;
  const reductionPercentage = Math.max(
    0,
    Math.round(((originalSize - compressedSize) / Math.max(originalSize, 1)) * 100),
  );

  let dataUrl = "";
  try {
    dataUrl = canvas.toDataURL(targetMimeType, quality);
  } catch {
    dataUrl = "";
  }

  // Safe File construction for legacy browsers (Safari < 14, older Android WebViews)
  let file: File;
  try {
    file = new File([blob], optimizedName, {
      type: targetMimeType,
      lastModified: Date.now(),
    });
  } catch {
    // Legacy fallback: augment Blob without any
    file = Object.assign(blob, {
      name: optimizedName,
      lastModified: Date.now(),
    }) as unknown as File;
  }

  return {
    file,
    blob,
    dataUrl,
    originalSize,
    compressedSize,
    reductionPercentage,
    width: targetWidth,
    height: targetHeight,
    originalName,
    optimizedName,
  };
}
