import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud, Trash2, CheckCircle2, Image as ImageIcon, AlertCircle, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFileWithWebPOptimization, deleteFileFromStorage, formatBytes } from "@/lib/storage-client";

export interface UploadedFileItem {
  id: string;
  name: string;
  fileKey: string;
  url: string;
  originalSize: number;
  compressedSize: number;
  reductionPercentage: number;
  dataUrl?: string;
}

interface FileUploaderProps {
  onFilesChange?: (files: UploadedFileItem[]) => void;
  folder?: string;
  maxFiles?: number;
  title?: string;
  subtitle?: string;
}

export function FileUploader({
  onFilesChange,
  folder = "uploads",
  maxFiles = 5,
  title = "بارگذاری عکس با تبدیل خودکار به WebP",
  subtitle = "تصاویر به صورت هوشمند فشرده و با فرمت فوق‌کم‌حجم WebP در فضای ابری پارس‌پک ذخیره می‌شوند.",
}: FileUploaderProps) {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(selectedFiles: FileList | File[]) {
    const fileList = Array.from(selectedFiles);
    if (!fileList.length) return;

    if (files.length + fileList.length > maxFiles) {
      setError(`حداکثر می‌توانید ${maxFiles} فایل بارگذاری کنید.`);
      return;
    }

    setError("");
    setIsProcessing(true);

    const newUploadedItems: UploadedFileItem[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setProcessingStatus(`در حال بهینه‌سازی و تبدیل «${file.name}» به فرمت فشرده WebP (${i + 1} از ${fileList.length})…`);

      try {
        const uploadResult = await uploadFileWithWebPOptimization(file, folder);

        const newItem: UploadedFileItem = {
          id: `f_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: uploadResult.optimizedName,
          fileKey: uploadResult.fileKey,
          url: uploadResult.url,
          originalSize: uploadResult.originalSize,
          compressedSize: uploadResult.compressedSize,
          reductionPercentage: uploadResult.reductionPercentage,
        };

        newUploadedItems.push(newItem);
      } catch (err: unknown) {
        console.error("[FileUploader error]", err);
        const message = err instanceof Error ? err.message : "خطا در پردازش و بارگذاری تصویر در پارس‌پک.";
        setError(message);
      }
    }

    const updated = [...files, ...newUploadedItems];
    setFiles(updated);
    onFilesChange?.(updated);
    setIsProcessing(false);
    setProcessingStatus("");
  }

  async function handleDelete(item: UploadedFileItem) {
    try {
      setProcessingStatus(`در حال حذف فایل از فضای ذخیره‌سازی ابری پارس‌پک…`);
      await deleteFileFromStorage(item.fileKey);

      const updated = files.filter((f) => f.id !== item.id);
      setFiles(updated);
      onFilesChange?.(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطا در حذف فایل از پارس‌پک.";
      setError(message);
    } finally {
      setProcessingStatus("");
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      void handleFiles(e.target.files);
    }
  }

  return (
    <div className="w-full space-y-4">
      {/* Upload Dropzone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border bg-card/60 hover:border-primary/60 hover:bg-card"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={maxFiles > 1}
          onChange={onInputChange}
          className="hidden"
        />

        <div className="mb-3 grid size-12 place-items-center rounded-full bg-accent text-primary transition-transform group-hover:scale-110">
          <UploadCloud className="size-6" />
        </div>

        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{subtitle}</p>

        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-3 py-1 text-[11px] font-medium text-foreground">
          <ImageIcon className="size-3.5 text-primary" />
          <span>پشتیبانی از انواع فرمت‌ها (تبدیل مستقیم به WebP کم‌حجم)</span>
        </div>
      </div>

      {/* Processing status banner */}
      {isProcessing && (
        <div className="flex items-center gap-2 rounded-lg bg-accent/60 p-3 text-xs text-primary animate-pulse">
          <div className="size-3 rounded-full bg-primary animate-ping" />
          <span>{processingStatus}</span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Uploaded WebP files list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            فایل‌های ذخیره‌شده در پارس‌پک ({files.length} از {maxFiles}):
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {files.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm"
              >
                {/* Thumbnail */}
                <div className="relative size-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  <img
                    src={item.url}
                    alt={item.name}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute bottom-0 right-0 bg-primary/90 px-1 py-0.2 text-[8px] font-bold text-white uppercase">
                    WebP
                  </span>
                </div>

                {/* File details & compression stats */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground" title={item.name}>
                    {item.name}
                  </p>

                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="line-through">{formatBytes(item.originalSize)}</span>
                    <ArrowDown className="size-2.5 text-emerald-500" />
                    <span className="font-bold text-foreground">{formatBytes(item.compressedSize)}</span>
                    {item.reductionPercentage > 0 && (
                      <span className="rounded bg-emerald-500/10 px-1 py-0.5 font-bold text-emerald-600 dark:text-emerald-400">
                        {item.reductionPercentage}٪ کاهش
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground">
                    <CheckCircle2 className="size-2.5 text-emerald-500" />
                    <span className="truncate">پارس‌پک (c833723)</span>
                  </div>
                </div>

                {/* Delete button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="حذف دائمی از فضای پارس‌پک"
                  onClick={() => handleDelete(item)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
