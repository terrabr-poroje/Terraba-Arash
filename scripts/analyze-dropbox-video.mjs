import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const exec = promisify(execFile);
const sourcePath = process.env.DROPBOX_SOURCE_PATH;
const outputFolder = process.env.DROPBOX_OUTPUT_FOLDER;
const appKey = process.env.DROPBOX_APP_KEY;
const appSecret = process.env.DROPBOX_APP_SECRET;
const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

function required(value, name) {
  if (!value?.trim()) throw new Error(`Missing required setting: ${name}`);
  return value.trim();
}
function dropboxArg(value) {
  return JSON.stringify(value);
}
async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: required(refreshToken, "DROPBOX_REFRESH_TOKEN"),
    client_id: required(appKey, "DROPBOX_APP_KEY"),
    client_secret: required(appSecret, "DROPBOX_APP_SECRET"),
  });
  const response = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Dropbox OAuth failed: HTTP ${response.status}`);
  return (await response.json()).access_token;
}
async function dbx(path, token, options = {}) {
  const response = await fetch(`https://api.dropboxapi.com/2/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox API ${path} failed: HTTP ${response.status} ${detail.slice(0, 400)}`);
  }
  return response.json();
}
async function downloadFile(path, token, destination) {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    headers: {
      authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": dropboxArg({ path }),
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Dropbox download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), (await import("node:fs")).createWriteStream(destination));
}
async function uploadFile(path, token, filePath, mode = "add") {
  const bytes = await readFile(filePath);
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "Dropbox-API-Arg": dropboxArg({
        path,
        mode,
        autorename: true,
        mute: true,
        strict_conflict: false,
      }),
    },
    body: bytes,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox upload failed: HTTP ${response.status} ${detail.slice(0, 400)}`);
  }
  return response.json();
}

required(sourcePath, "DROPBOX_SOURCE_PATH");
required(outputFolder, "DROPBOX_OUTPUT_FOLDER");
if (!sourcePath.startsWith("/") || !outputFolder.startsWith("/")) {
  throw new Error("Dropbox paths must be absolute paths beginning with /.");
}
if (sourcePath.startsWith(outputFolder + "/") || outputFolder.startsWith(sourcePath + "/")) {
  throw new Error("Source and output paths must be separate.");
}
if (outputFolder.startsWith("/TERRABAR – Media Center/")) {
  throw new Error("Analysis output must not be written inside the shared media center.");
}

const token = await getAccessToken();
const metadata = await dbx("files/get_metadata", token, {
  path: sourcePath,
  include_media_info: true,
});
if (metadata[".tag"] !== "file" || !/^video\//i.test(metadata.mime_type ?? "")) {
  throw new Error("Selected Dropbox item is not a video file.");
}
if (metadata.size > 2 * 1024 * 1024 * 1024) {
  throw new Error("Video exceeds the 2 GB test limit.");
}
const folder = await dbx("files/get_metadata", token, { path: outputFolder });
if (folder[".tag"] !== "folder" || folder.sharing_info?.shared_folder_id || folder.sharing_info?.parent_shared_folder_id || folder.sharing_info?.is_inside_team_folder) {
  throw new Error("Output folder must exist and must not be a shared folder.");
}

const workDir = await mkdtemp(join(tmpdir(), "terrabar-media-"));
try {
  const input = join(workDir, basename(sourcePath));
  await downloadFile(sourcePath, token, input);
  const probe = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate",
    "-of", "json", input,
  ]);
  const media = JSON.parse(probe.stdout);
  const duration = Number(media.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read video duration.");

  const frameFiles = [];
  for (let i = 0; i < 6; i++) {
    const second = Math.min(Math.max(0, duration * ((i + 0.5) / 6)), Math.max(0, duration - 0.2));
    const frame = join(workDir, `frame-${String(i + 1).padStart(2, "0")}.jpg`);
    await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", second.toFixed(2), "-i", input,
      "-frames:v", "1", "-vf", "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2",
      "-q:v", "3", frame,
    ]);
    frameFiles.push(frame);
  }

  const contactSheet = join(workDir, "contact-sheet.jpg");
  const inputs = frameFiles.flatMap((file) => ["-i", file]);
  const filters = frameFiles.map((_, i) => `[${i}:v]setsar=1[v${i}]`).join(";");
  const layout = "0_0|480_0|960_0|0_270|480_270|960_270";
  await exec("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputs,
    "-filter_complex", `${filters};[v0][v1][v2][v3][v4][v5]xstack=inputs=6:layout=${layout}:fill=black[out]`,
    "-map", "[out]", "-frames:v", "1", contactSheet,
  ]);

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const stem = basename(sourcePath).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const jsonPath = join(workDir, "metadata.json");
  const report = {
    source_name: basename(sourcePath),
    source_path: sourcePath,
    source_size_bytes: metadata.size,
    processed_at: new Date().toISOString(),
    duration_seconds: duration,
    format: media.format,
    streams: media.streams,
    sampled_frames_seconds: frameFiles.map((_, i) => Number(Math.min(duration * ((i + 0.5) / 6), duration - 0.2).toFixed(2))),
    note: "Temporary analysis only. Original video was not modified or moved.",
  };
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  const imageResult = await uploadFile(`${outputFolder}/${stem}-contact-sheet-${stamp}.jpg`, token, contactSheet);
  const jsonResult = await uploadFile(`${outputFolder}/${stem}-metadata-${stamp}.json`, token, jsonPath);
  await writeFile(process.env.GITHUB_STEP_SUMMARY, [
    "# Terrabar media analysis",
    "",
    `- Video: ${basename(sourcePath)}`,
    `- Duration: ${duration.toFixed(1)} seconds`,
    `- Size: ${metadata.size} bytes`,
    `- Contact sheet: ${imageResult.path_display}`,
    `- Metadata: ${jsonResult.path_display}`,
    "- Original video unchanged; local temporary files removed after processing.",
  ].join("\n"));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
